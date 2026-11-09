import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "../../db/prisma";
import { supportAgent, salesAgent } from "../fixtures";
import { type AgentConfig } from "../contracts";
import { PrismaRunStore } from "../storage/prisma-store";
import { createAgent, updateAgent, rollbackAgent } from "../library/store";
import { POST as execute } from "../../../app/api/agents/[id]/run/route";
import { processExecutionJob } from "@/lib/jobs/worker";
import { POST as decide } from "../../../app/api/approvals/[id]/route";

const db = getDb();
const runIds: string[] = [];
const jobIds: string[] = [];
const cursors = new Map<string, number>();
const agentIds: string[] = [];
beforeEach(() => {
  // Exercise the generic review/resume protocol using a test-only reviewed
  // writer. Production internal tickets are tested separately as immediate.
  const lookup = runtimeRegistry.get.bind(runtimeRegistry);
  vi.spyOn(runtimeRegistry, "get").mockImplementation(id => {
    const tool = lookup(id); return tool?.id === "create_ticket" ? { ...tool, approvalExempt: false } : tool;
  });
  vi.stubEnv("RUNTIME_MODEL_MAX_RETRIES", "0");
  vi.stubEnv("RUNTIME_FALLBACK_PROFILE", "");
  vi.stubEnv("RUNTIME_ALLOW_DEMO_TOKEN", "true");
  vi.stubEnv("RUNTIME_API_TOKEN", "end-to-end-test-token-not-a-secret");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key-not-real");
  vi.stubEnv("RUNTIME_MODEL_ID", "gemini-2.5-flash-lite");
  vi.stubEnv("RUNTIME_INPUT_USD_PER_MILLION", "1");
  vi.stubEnv("RUNTIME_OUTPUT_USD_PER_MILLION", "2");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  for (const jobId of jobIds.splice(0)) {
    await db.$queryRaw`SELECT (graphile_worker.remove_job(${jobId})).id::text AS id`;
    await db.executionJob.deleteMany({ where: { id: jobId } });
  }
  for (const runId of runIds.splice(0)) {
    await db.demoTicket.deleteMany({ where: { idempotencyKey: { startsWith: `${runId}:` } } });
    await db.agentRun.deleteMany({ where: { id: runId } });
  }
  await db.agent.deleteMany({ where: { id: { in: agentIds.splice(0) } } });
  await db.$disconnect();
});
async function agent(config: AgentConfig) {
  const copy = { ...config, id: `e2e-${randomUUID()}` }; agentIds.push(copy.id);
  await db.agent.create({ data: { id: copy.id, ownerId: copy.ownerId, name: copy.name, version: copy.version, config: copy } });
  return copy;
}
function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/test", { method: "POST", headers: {
    authorization: "Bearer end-to-end-test-token-not-a-secret", "content-type": "application/json", "Idempotency-Key": randomUUID(),
  }, body: JSON.stringify(body), signal });
}
function providerScript(parts: unknown[][]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) throw new Error("unexpected network request");
    const next = parts.shift(); if (!next) throw new Error("unexpected provider retry");
    return Response.json({ candidates: [{ content: { role: "model", parts: next }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 } });
  }));
}
async function readEvents(response: Response) {
  expect(response.status).toBe(202);
  const receipt = await response.json() as { jobId: string; runId: string };
  jobIds.push(receipt.jobId); if (!runIds.includes(receipt.runId)) runIds.push(receipt.runId);
  await processExecutionJob(receipt.jobId);
  const history = await new PrismaRunStore(db).history(receipt.runId, "demo", cursors.get(receipt.runId) ?? 0);
  cursors.set(receipt.runId, history.events.at(-1)?.sequence ?? 0);
  return history.events;
}
it("runs two stored configurations through their distinct real demo tools", async () => {
  for (const [config, toolId] of [[supportAgent, "knowledge_search"], [salesAgent, "sales_lookup"]] as const) {
    const saved = await agent(config);
    providerScript([[{ functionCall: { name: toolId, args: { query: "returns" } } }], [{ text: "Answer from retrieved data." }]]);
    const events = await readEvents(await execute(request({ message: "test" }), { params: Promise.resolve({ id: saved.id }) }));
    expect(events.at(-1)?.type).toBe("run_completed");
    const result = events.find(e => e.type === "tool_finished");
    expect(result?.payload).toMatchObject({ toolId, output: { source: toolId === "knowledge_search" ? "knowledge_base" : "sample_sales" } });
    const history = await new PrismaRunStore(db).history(events[0].runId, "demo");
    expect(history.events).toEqual(events);
  }
});
it("pauses a real demo write and resumes through the approval HTTP handler exactly once", async () => {
  const saved = await agent(supportAgent);
  providerScript([[{ functionCall: { name: "create_ticket", args: { subject: "E2E ticket" } } }], [{ text: "Ticket created." }]]);
  const events = await readEvents(await execute(request({ message: "create ticket" }), { params: Promise.resolve({ id: saved.id }) }));
  const runId = events[0].runId;
  expect(await db.demoTicket.count({ where: { idempotencyKey: { startsWith: `${runId}:` } } })).toBe(0);
  const waiting = events.at(-1)!;
  if (waiting.type !== "approval_required") throw new Error("expected approval wait");
  const context = { params: Promise.resolve({ id: waiting.payload.approvalId }) };
  const resumed = await readEvents(await decide(request({ approved: true }), context));
  expect(resumed.at(-1)?.type).toBe("run_completed");
  expect(resumed[0].sequence).toBe(waiting.sequence + 1);
  expect(new Set([...events, ...resumed].map(e => e.runId))).toEqual(new Set([runId]));
  expect(await db.demoTicket.count({ where: { idempotencyKey: { startsWith: `${runId}:` } } })).toBe(1);
  expect((await decide(request({ approved: true }), context)).status).toBe(202);
});
it("continues a durably queued approval after the browser disconnects during its claim", async () => {
  const saved = await agent(supportAgent);
  providerScript([[{ functionCall: { name: "create_ticket", args: { subject: "Disconnected approval" } } }], [{ text: "Ticket created after disconnect." }]]);
  const events = await readEvents(await execute(request({ message: "create ticket" }), { params: Promise.resolve({ id: saved.id }) }));
  const waiting = events.at(-1)!;
  if (waiting.type !== "approval_required") throw new Error("expected approval wait");
  const runId = events[0].runId;
  const controller = new AbortController();
  const original = PrismaRunStore.prototype.claimApproval;
  vi.spyOn(PrismaRunStore.prototype, "claimApproval").mockImplementationOnce(async function (this: PrismaRunStore, ...args) {
    const claim = await original.apply(this, args);
    controller.abort();
    return claim;
  });
  const context = { params: Promise.resolve({ id: waiting.payload.approvalId }) };
  const response = await decide(request({ approved: true }, controller.signal), context);
  // The durable worker is independent of the disconnected response reader.
  await readEvents(response);
  const history = await new PrismaRunStore(db).history(runId, "demo");
  expect(history.status).toBe("completed");
  expect(history.stopReason).toBeNull();
  expect(history.events.at(-1)?.type).toBe("run_completed");
  expect(await db.demoTicket.count({ where: { idempotencyKey: { startsWith: `${runId}:` } } })).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect((await decide(request({ approved: true }), context)).status).toBe(202);
});
it("runs builder-created versions and resumes the original snapshot across edits and rollback", async () => {
  const original = await createAgent("demo", {
    name: "Version integration", instructions: supportAgent.instructions, enabledTools: supportAgent.enabledTools,
  });
  agentIds.push(original.id);
  providerScript([
    [{ functionCall: { name: "create_ticket", args: { subject: "Versioned ticket" } } }],
    [{ text: "Original snapshot ticket created." }],
    [{ functionCall: { name: "knowledge_search", args: { query: "returns" } } }],
    [{ text: "Policy from rolled-back configuration." }],
  ]);
  const context = { params: Promise.resolve({ id: original.id }) };
  const waiting = await readEvents(await execute(request({ message: "create a ticket" }), context));
  const approval = waiting.at(-1)!;
  if (approval.type !== "approval_required") throw new Error("expected approval pause");
  const updated = await updateAgent("demo", original.id, {
    name: "Edited version", instructions: salesAgent.instructions, enabledTools: salesAgent.enabledTools,
  });
  expect(updated.version).toBe(2);
  const resumed = await readEvents(await decide(request({ approved: true }), { params: Promise.resolve({ id: approval.payload.approvalId }) }));
  expect(resumed.at(-1)?.type).toBe("run_completed");
  const oldRun = await new PrismaRunStore(db).loadRun(waiting[0].runId, "demo");
  expect(oldRun.config.version).toBe(1);
  expect(oldRun.config.enabledTools).toEqual(supportAgent.enabledTools);
  const restored = await rollbackAgent("demo", original.id, 1);
  expect(restored.version).toBe(3);
  expect(restored.config.enabledTools).toEqual(supportAgent.enabledTools);
  expect(restored.versions).toHaveLength(3);
  const next = await readEvents(await execute(request({ message: "check return policy" }), context));
  expect(next.at(-1)?.type).toBe("run_completed");
  const newRun = await new PrismaRunStore(db).loadRun(next[0].runId, "demo");
  expect(newRun.config.version).toBe(3);
});

it.each([[429, "model_rate_limited"], [400, "model_request_rejected"], [503, "model_unavailable"]])("persists a safe actionable model failure for HTTP %s", async (status, reason) => {
  const saved = await agent(supportAgent);
  const fetch = vi.fn(async () => Response.json({ error: { code: status, message: "PRIVATE provider body secret", status: "ERROR" } }, { status }));
  vi.stubGlobal("fetch", fetch);
  const events = await readEvents(await execute(request({ message: "Compare prices" }), { params: Promise.resolve({ id: saved.id }) }));
  expect(events.at(-1)).toMatchObject({ type: "run_failed", payload: { reason } });
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
  expect(fetch).toHaveBeenCalledOnce();
  const history = await new PrismaRunStore(db).history(events[0].runId, "demo");
  expect(history.stopReason).toBe(reason);
});
