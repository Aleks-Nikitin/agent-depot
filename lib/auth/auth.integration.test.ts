import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "../db/prisma";
import { getAuth } from "../auth";
import { GET as list, POST as create } from "../../app/api/agents/route";
import { GET as read, PUT as update, DELETE as remove } from "../../app/api/agents/[id]/route";
import { POST as execute } from "../../app/api/agents/[id]/run/route";
import { POST as approve } from "../../app/api/approvals/[id]/route";
import { GET as metrics } from "../../app/api/runtime/metrics/route";
import { GET as history } from "../../app/api/runs/[id]/route";
import { GET as runs } from "../../app/api/runs/route";

const db = getDb();
const prefix = `auth-${randomUUID()}`;
const origin = "http://localhost:3000";
const password = `Test-${randomUUID()}-password`;
const users: { id: string; email: string; cookie: string }[] = [];
const runIds: string[] = [];
const verificationIdentifiers: string[] = [];
let agentId: string;
function request(path: string, method = "GET", body?: unknown, cookie = "") {
  return new Request(origin + path, { method, headers: { origin, cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; "); }
async function events(response: Response) {
  expect(response.status).toBe(200);
  const result = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  if (result[0]?.runId) runIds.push(result[0].runId);
  return result;
}
// Keep authorization/approval tests focused on a generic reviewed writer.
beforeEach(() => {
  const lookup = runtimeRegistry.get.bind(runtimeRegistry);
  vi.spyOn(runtimeRegistry, "get").mockImplementation(id => {
    const tool = lookup(id); return tool?.id === "create_ticket" ? { ...tool, approvalExempt: false } : tool;
  });
});
beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-auth-secret-over-thirty-two-characters");
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("RUNTIME_ALLOW_DEMO_TOKEN", "false");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "not-a-real-key");
  vi.stubEnv("RUNTIME_MODEL_ID", "gemini-2.5-flash-lite");
  vi.stubEnv("RUNTIME_INPUT_USD_PER_MILLION", "1"); vi.stubEnv("RUNTIME_OUTPUT_USD_PER_MILLION", "2");
  vi.stubEnv("GITHUB_CLIENT_ID", "integration-only-github-client");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "integration-only-github-secret");
  for (const suffix of ["a", "b"]) {
    const email = `${prefix}-${suffix}@example.test`;
    const response = await getAuth().handler(request("/api/auth/sign-up/email", "POST", { name: `Test ${suffix}`, email, password }));
    expect(response.status).toBe(200);
    const result = await response.json();
    users.push({ id: result.user.id, email, cookie: cookies(response) });
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => {
  const ids = users.map(user => user.id);
  await db.demoTicket.deleteMany({ where: { ownerId: { in: ids } } });
  await db.agentRun.deleteMany({ where: { id: { in: runIds } } });
  await db.agent.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.verification.deleteMany({ where: { identifier: { in: verificationIdentifiers } } });
  await db.$disconnect(); vi.unstubAllEnvs();
});

it("creates hashed credentials and database sessions, rejects bad passwords, and revokes logout sessions", async () => {
  const account = await db.account.findFirstOrThrow({ where: { userId: users[0].id, providerId: "credential" } });
  expect(account.password).toBeTruthy(); expect(account.password).not.toBe(password);
  const session = await getAuth().handler(request("/api/auth/get-session", "GET", undefined, users[0].cookie));
  expect((await session.json()).user.id).toBe(users[0].id);
  const bad = await getAuth().handler(request("/api/auth/sign-in/email", "POST", { email: users[0].email, password: "wrong-password" }));
  expect(bad.status).toBe(401);
  const login = await getAuth().handler(request("/api/auth/sign-in/email", "POST", { email: users[0].email, password }));
  expect(login.status).toBe(200);
  const cookie = cookies(login);
  const logout = await getAuth().handler(request("/api/auth/sign-out", "POST", {}, cookie));
  expect(logout.status).toBe(200);
  const revoked = await getAuth().handler(request("/api/auth/get-session", "GET", undefined, cookie));
  expect(await revoked.json()).toBeNull();
});

it("scopes builder CRUD to the session and blocks anonymous, forged-owner and cross-site requests", async () => {
  expect((await list(request("/api/agents"))).status).toBe(401);
  const body = { name: "Private agent", instructions: "Create a ticket only after approval.", enabledTools: ["create_ticket"] };
  const response = await create(request("/api/agents", "POST", body, users[0].cookie));
  expect(response.status).toBe(201);
  const created = await response.json(); agentId = created.id;
  expect(created.config.ownerId).toBe(users[0].id);
  expect((await (await list(request("/api/agents", "GET", undefined, users[1].cookie))).json()).agents).toEqual([]);
  const context = { params: Promise.resolve({ id: agentId }) };
  for (const method of [read, update, remove]) {
    const verb = method === read ? "GET" : method === update ? "PUT" : "DELETE";
    expect((await method(request(`/api/agents/${agentId}`, verb, verb === "PUT" ? body : undefined, users[1].cookie), context)).status).toBe(404);
  }
  const forged = request("/api/agents", "POST", { ...body, ownerId: users[1].id }, users[0].cookie);
  expect((await create(forged)).status).toBe(400);
  const crossSite = request("/api/agents", "POST", body, users[0].cookie);
  crossSite.headers.set("origin", "https://untrusted.example");
  expect((await create(crossSite)).status).toBe(403);
  const missingOrigin = request("/api/agents", "POST", body, users[0].cookie);
  missingOrigin.headers.delete("origin");
  expect((await create(missingOrigin)).status).toBe(403);
});

it("uses the real session for execution, approval ownership and metrics without a browser bearer token", async () => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "not-a-real-key");
  vi.stubEnv("RUNTIME_MODEL_ID", "gemini-2.5-flash-lite");
  vi.stubEnv("RUNTIME_INPUT_USD_PER_MILLION", "1"); vi.stubEnv("RUNTIME_OUTPUT_USD_PER_MILLION", "2");
  vi.stubEnv("RUNTIME_METRICS_BACKEND", "postgres");
  const parts = [[{ functionCall: { name: "create_ticket", args: { subject: "Auth integration ticket" } } }], [{ text: "Ticket created." }]];
  const fetch = vi.fn(async () => Response.json({ candidates: [{ content: { role: "model", parts: parts.shift() }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 } }));
  vi.stubGlobal("fetch", fetch);
  const context = { params: Promise.resolve({ id: agentId }) };
  expect((await execute(request(`/api/agents/${agentId}/run`, "POST", { message: "create ticket" }, users[1].cookie), context)).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
  const waiting = await events(await execute(request(`/api/agents/${agentId}/run`, "POST", { message: "create ticket" }, users[0].cookie), context));
  const approval = waiting.at(-1);
  expect(approval.type).toBe("approval_required");
  const decisionContext = { params: Promise.resolve({ id: approval.payload.approvalId }) };
  expect((await approve(request("/api/approvals/test", "POST", { approved: true }, users[1].cookie), decisionContext)).status).toBe(404);
  expect(await db.demoTicket.count({ where: { ownerId: users[0].id } })).toBe(0);
  const finished = await events(await approve(request("/api/approvals/test", "POST", { approved: true }, users[0].cookie), decisionContext));
  expect(finished.at(-1).type).toBe("run_completed");
  expect(await db.demoTicket.count({ where: { ownerId: users[0].id } })).toBe(1);
  const metric = await db.runtimeMetric.findFirstOrThrow({ where: { runId: waiting[0].runId } });
  const from = new Date(Math.floor(metric.finishedAt.getTime() / 3_600_000) * 3_600_000);
  const to = new Date(from.getTime() + 3_600_000);
  const path = `/api/runtime/metrics?from=${from.toISOString()}&to=${to.toISOString()}&agentId=${agentId}`;
  expect((await (await metrics(request(path, "GET", undefined, users[0].cookie))).json()).buckets[0].runs).toBe(1);
  expect((await (await metrics(request(path, "GET", undefined, users[1].cookie))).json()).buckets).toEqual([]);
  const historyContext = { params: Promise.resolve({ id: waiting[0].runId }) };
  const replay = await history(request(`/api/runs/${waiting[0].runId}?after=0`, "GET", undefined, users[0].cookie), historyContext);
  expect(replay.status).toBe(200);
  const trace = await replay.json();
  expect(trace.runId).toBe(waiting[0].runId);
  expect(trace.events.at(-1).type).toBe("run_completed");
  expect(trace).not.toHaveProperty("checkpoint");
  expect((await history(request(`/api/runs/${waiting[0].runId}?after=0`, "GET", undefined, users[1].cookie), historyContext)).status).toBe(404);
  const page = await runs(request(`/api/runs?agentId=${agentId}`, "GET", undefined, users[0].cookie));
  expect(page.status).toBe(200); expect((await page.json()).runs).toHaveLength(1);
});

it("starts GitHub OAuth with the configured local callback and rejects forged callback state", async () => {
  const response = await getAuth().handler(request("/api/auth/sign-in/social", "POST", { provider: "github", callbackURL: "/", errorCallbackURL: "/auth?error=oauth" }));
  expect(response.status).toBe(200);
  const result = await response.json();
  const url = new URL(result.url);
  expect(url.origin).toBe("https://github.com");
  expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/github`);
  expect(url.searchParams.get("state")).toBeTruthy();
  verificationIdentifiers.push(`auth-state:${url.searchParams.get("state")}`);
  const callback = await getAuth().handler(request("/api/auth/callback/github?code=fake&state=forged-state"));
  expect(callback.status).toBe(302);
  expect(new URL(callback.headers.get("location")!, origin).searchParams.has("error")).toBe(true);
});

it("completes a simulated GitHub callback with verified email, encrypted provider token and a usable session", async () => {
  const email = `${prefix}-github@example.test`;
  const accessToken = "simulated-github-token-not-real";
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: accessToken, token_type: "bearer", scope: "read:user,user:email" });
    if (url === "https://api.github.com/user") return Response.json({ id: prefix, login: "test-user", name: "GitHub test", email: null, avatar_url: "https://example.test/avatar.png" });
    if (url === "https://api.github.com/user/emails") return Response.json([{ email, primary: true, verified: true }]);
    throw new Error("unexpected OAuth network request");
  }));
  const start = await getAuth().handler(request("/api/auth/sign-in/social", "POST", { provider: "github", callbackURL: "/" }));
  expect(start.status).toBe(200);
  const state = new URL((await start.json()).url).searchParams.get("state");
  verificationIdentifiers.push(`auth-state:${state}`);
  const callback = await getAuth().handler(request(`/api/auth/callback/github?code=test-code&state=${state}`, "GET", undefined, cookies(start)));
  expect(callback.status).toBe(302);
  expect(new URL(callback.headers.get("location")!, origin).pathname).toBe("/");
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  users.push({ id: user.id, email, cookie: cookies(callback) });
  expect(user.emailVerified).toBe(true);
  const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: "github" } });
  expect(account.accessToken).toBeTruthy(); expect(account.accessToken).not.toBe(accessToken);
  expect((await list(request("/api/agents", "GET", undefined, cookies(callback)))).status).toBe(200);
});

it("gives each guest a separate session and full agent CRUD/runtime access without inheriting demo data", async () => {
  const guests = [];
  for (let index = 0; index < 2; index++) {
    const response = await getAuth().handler(request("/api/auth/sign-in/anonymous", "POST", {}));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.user.isAnonymous).toBe(true);
    const guest = { id: result.user.id, email: result.user.email, cookie: cookies(response) };
    users.push(guest); guests.push(guest);
  }
  expect(guests[0].id).not.toBe(guests[1].id);
  const body = { name: "Guest agent", instructions: "Answer briefly.", enabledTools: [] };
  const created = await create(request("/api/agents", "POST", body, guests[0].cookie));
  expect(created.status).toBe(201);
  const agent = await created.json();
  const context = { params: Promise.resolve({ id: agent.id }) };
  expect((await read(request(`/api/agents/${agent.id}`, "GET", undefined, guests[1].cookie), context)).status).toBe(404);
  expect((await (await list(request("/api/agents", "GET", undefined, guests[1].cookie))).json()).agents).toEqual([]);
  expect((await update(request(`/api/agents/${agent.id}`, "PUT", { ...body, name: "Edited guest agent" }, guests[0].cookie), context)).status).toBe(200);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "Guest answer" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 } })));
  const finished = await events(await execute(request(`/api/agents/${agent.id}/run`, "POST", { message: "Hello" }, guests[0].cookie), context));
  expect(finished.at(-1).type).toBe("run_completed");
  expect((await remove(request(`/api/agents/${agent.id}`, "DELETE", undefined, guests[0].cookie), context)).status).toBe(204);
});
