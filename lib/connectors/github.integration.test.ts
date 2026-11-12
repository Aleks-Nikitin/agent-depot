import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { AgentConfigSchema } from "@/lib/agents/contracts";
import { connectGitHub, disconnectGitHub, githubAvailable, createGitHubIssue, reconcileGitHubIssue, listGitHubIssues } from "./github";
import { decryptCredential } from "./secrets";

const db = getDb(), owners: string[] = [];
vi.stubEnv("CONNECTOR_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
const token = "fixture_credential_never_live_1234567890";
async function fixture() {
  const ownerId = `connector-${randomUUID()}`; owners.push(ownerId);
  const metadata = vi.fn(async () => Response.json({ full_name: "test/repository", has_issues: true })) as unknown as typeof fetch;
  const connection = await connectGitHub(ownerId, { repository: "test/repository", token, allowWrites: true }, new AbortController().signal, metadata);
  const config = AgentConfigSchema.parse({ id: randomUUID(), ownerId, version: 1, name: "Issue triage", instructions: "Create a reviewed issue only.", model: "gemini", enabledTools: ["github_list_issues", "github_create_issue"], github: { connectionId: connection.id, revision: connection.revision } });
  return { ownerId, connection, config };
}
afterAll(async () => {
  await db.connectorOperation.deleteMany({ where: { ownerId: { in: owners } } });
  await db.gitHubConnection.deleteMany({ where: { ownerId: { in: owners } } });
  await db.workspace.deleteMany({ where: { ownerId: { in: owners } } });
  vi.unstubAllEnvs(); await db.$disconnect();
});
it("encrypts scoped credentials, hides them from metadata, and invalidates rotation, disconnect and cross-owner access", async () => {
  const { ownerId, connection, config } = await fixture();
  expect(JSON.stringify(connection)).not.toContain(token);
  const row = await db.gitHubConnection.findUniqueOrThrow({ where: { ownerId } });
  expect(row.credential).not.toContain(token);
  expect(decryptCredential(row.credential, ownerId, row.id, row.revision)).toBe(token);
  expect(() => decryptCredential(row.credential, "other", row.id, row.revision)).toThrow("connector_credential_unavailable");
  expect(await githubAvailable(config, true)).toBe(true);
  expect(await githubAvailable({ ...config, ownerId: "other" }, true)).toBe(false);
  await connectGitHub(ownerId, { repository: "test/repository", token, allowWrites: false }, new AbortController().signal,
    (async () => Response.json({ full_name: "test/repository", has_issues: true })) as typeof fetch);
  expect(await githubAvailable(config, false)).toBe(false);
  await disconnectGitHub(ownerId);
  expect((await db.gitHubConnection.findUniqueOrThrow({ where: { ownerId } })).credential).toBe("");
});
it("records intent before effects, never repeats an ambiguous POST, and reconciles the exact issue read-only", async () => {
  const { ownerId, config } = await fixture();
  const input = { title: "Investigate return policy", body: "Reviewed request." };
  const context = { idempotencyKey: randomUUID(), runId: randomUUID(), signal: new AbortController().signal };
  let submitted: { title: string; body: string } | undefined;
  const ambiguous = vi.fn(async (_url, options) => {
    expect(await db.connectorOperation.findUnique({ where: { key: context.idempotencyKey } })).toMatchObject({ status: "unknown", input });
    submitted = JSON.parse(String(options?.body)); throw new Error("connection lost after remote effect");
  }) as unknown as typeof fetch;
  await expect(createGitHubIssue(config, input, context, ambiguous)).rejects.toThrow("connector_outcome_unknown");
  await expect(createGitHubIssue(config, input, context, ambiguous)).rejects.toThrow("connector_outcome_unknown");
  expect(ambiguous).toHaveBeenCalledTimes(1);
  const reader = vi.fn(async () => Response.json([{ number: 42, ...submitted }])) as unknown as typeof fetch;
  expect(await reconcileGitHubIssue(ownerId, context.idempotencyKey, context.signal, reader)).toMatchObject({ status: "completed", result: { number: 42, url: "https://github.com/test/repository/issues/42" } });
  expect(await createGitHubIssue(config, input, context, ambiguous)).toMatchObject({ number: 42 });
  expect(ambiguous).toHaveBeenCalledTimes(1);
  await expect(createGitHubIssue(config, { ...input, title: "changed" }, context, ambiguous)).rejects.toThrow("idempotency_conflict");
});
it("handles 401 and 429 without retries, returns bounded issue data, and records successful writes once", async () => {
  const { config } = await fixture();
  for (const status of [401, 429]) {
    const denied = vi.fn(async () => new Response("private provider response", { status })) as unknown as typeof fetch;
    const context = { idempotencyKey: randomUUID(), runId: randomUUID(), signal: new AbortController().signal };
    await expect(createGitHubIssue(config, { title: "Test", body: "Body" }, context, denied)).rejects.toThrow(status === 401 ? "connector_access_denied" : "connector_rate_limited");
    await expect(createGitHubIssue(config, { title: "Test", body: "Body" }, context, denied)).rejects.toThrow();
    expect(denied).toHaveBeenCalledTimes(1);
    expect(await db.connectorOperation.findUnique({ where: { key: context.idempotencyKey } })).toMatchObject({ status: "rejected" });
  }
  const signal = new AbortController().signal;
  const reader = vi.fn(async () => Response.json([{ number: 3, title: "Issue", body: token + "x".repeat(2000) }, { number: 4, title: "PR", pull_request: {} }])) as unknown as typeof fetch;
  const result = await listGitHubIssues(config, { state: "open" }, signal, reader);
  expect(result.issues).toHaveLength(1); expect(result.issues[0].excerpt.length).toBe(1500); expect(JSON.stringify(result)).not.toContain(token);
  const writer = vi.fn(async () => Response.json({ number: 7, title: "Test" })) as unknown as typeof fetch;
  const context = { idempotencyKey: randomUUID(), runId: randomUUID(), signal };
  await createGitHubIssue(config, { title: "Test", body: "Body" }, context, writer);
  await createGitHubIssue(config, { title: "Test", body: "Body" }, context, writer);
  expect(writer).toHaveBeenCalledTimes(1);
});
