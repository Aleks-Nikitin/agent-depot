import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { createAgent, duplicateAgent, updateAgent } from "@/lib/agents/library/store";
import { createTestCase, listTestCases, updateTestCase } from "../test-cases";
import { runEvaluation } from "../runner";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { ModelDriver } from "@/lib/agents/runtime/model";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { testFingerprint } from "../fingerprint";
import { getPublishStatus, latestTestReport } from "../publish-gate";
import { openEvaluationClient } from "../isolation/connection";
import { promoteRelease } from "@/lib/agents/releases/promote";
import { resolveServingRelease } from "@/lib/agents/releases/resolve";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb(); const ownerId = `outcomes-it-${randomUUID()}`; const ids: string[] = [];
const input = { name: "Outcome fixture", instructions: "correct", model: "gemini", enabledTools: ["create_ticket"] };
const driver: ModelDriver = { key: "outcome-fixture", estimate: () => 0.00001, turn: async (config, messages) => {
  if (messages.some(m => m.role === "tool") || config.instructions === "no-effect") return { text: "Created successfully", calls: [], messages: [], inputTokens: 1, outputTokens: 1 };
  return { text: "", messages: [], calls: Array.from({ length: config.instructions === "duplicate" ? 2 : 1 }, (_, i) => ({ toolCallId: `ticket-${i}`, toolId: "create_ticket", input: { subject: config.instructions === "wrong-field" ? "Invalid subject" : "Review 1042" } })), inputTokens: 1, outputTokens: 1 };
} };
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver };
async function setup() {
  const agent = await createAgent(ownerId, input); ids.push(agent.id);
  const test = await createTestCase(ownerId, agent.id, { input: "Create a ticket for order 1042", mustCall: ["create_ticket"], mustContain: ["successfully"],
    fixtures: { tickets: [{ id: "seed-ticket", subject: "Keep this record", idempotencyKey: "seed-key" }] },
    stateAssertions: [{ kind: "count", table: "tickets", equals: 2 }, { kind: "record", table: "tickets", where: { subject: "Review 1042" }, fields: { ownerId } }] });
  return { agent, test };
}
afterAll(async () => {
  const runs = await db.agentRun.findMany({ where: { ownerId }, select: { id: true } });
  for (const run of runs) await (await graphCheckpointer()).deleteThread(run.id);
  await db.testRun.deleteMany({ where: { agentId: { in: ids } } });
  await db.agentRun.deleteMany({ where: { ownerId } });
  await db.agent.deleteMany({ where: { ownerId } });
  await db.knowledgeDocument.deleteMany({ where: { ownerId } });
  await db.workspace.deleteMany({ where: { ownerId } }); await db.$disconnect();
});
it("persists seeded state, exact counts/fields and diffs without losing case contracts", async () => {
  const { agent, test } = await setup();
  const baseline = await db.demoTicket.count();
  const report = await runEvaluation(ownerId, agent.id, undefined, deps);
  expect(report.results[0].status).toBe("passed");
  const proof = report.results[0].stateEvidence!;
  expect(proof.before.tickets).toHaveLength(1); expect(proof.after.tickets).toHaveLength(2);
  expect((proof.diff as { tickets: { added: unknown[] } }).tickets.added).toHaveLength(1);
  expect(proof.assertions.every(a => a.passed)).toBe(true);
  const { hash, ...payload } = proof; expect(hash).toBe(artifactHash(payload));
  const before = testFingerprint(await listTestCases(ownerId, agent.id));
  await updateTestCase(ownerId, test.id, { input: "Reworded request" });
  const saved = (await listTestCases(ownerId, agent.id))[0];
  expect(saved.fixtures).toEqual(test.fixtures); expect(saved.stateAssertions).toEqual(test.stateAssertions);
  expect(testFingerprint([saved])).not.toBe(before);
  const copy = await duplicateAgent(ownerId, agent.id); ids.push(copy.id);
  expect((await listTestCases(ownerId, copy.id))[0].stateAssertions).toEqual(saved.stateAssertions);
  await expect(updateTestCase("another-owner", test.id, { stateAssertions: [] })).rejects.toThrow("test_not_found");
  await expect(updateTestCase(ownerId, test.id, { stateAssertions: [{ kind: "record", table: "tickets", fields: { password: "invalid" } }] })).rejects.toThrow();
  expect(await db.demoTicket.count()).toBe(baseline);
});
it("fails polite duplicate, incorrect and absent effects while preserving the serving release", async () => {
  const { agent } = await setup();
  await runEvaluation(ownerId, agent.id, undefined, deps);
  const release = await promoteRelease(ownerId, agent.id);
  const client = await openEvaluationClient();
  let mode = "";
  const registry = new Map(runtimeRegistry);
  const ticket = registry.get("create_ticket")!;
  registry.set("create_ticket", { ...ticket, run: async (input, context) => {
    const result = await ticket.run(input, context);
    if (mode === "forbidden") {
      const id = context.domain?.scope.kind === "evaluation" ? context.domain.scope.attemptId : "";
      const scope = (await client.query<{ schemaName: string }>('SELECT "schemaName" FROM agentdepot_eval."Attempt" WHERE "id"=$1', [id])).rows[0].schemaName;
      if (!/^attempt_[a-f0-9]{32}$/.test(scope)) throw new Error("invalid_fixture_scope");
      await client.query(`UPDATE "${scope}"."WorkspaceOrder" SET "status"='refunded'`);
    }
    return result;
  } });
  try { for (mode of ["duplicate", "wrong-field", "no-effect", "forbidden"]) {
    await updateAgent(ownerId, agent.id, { ...input, instructions: mode });
    const report = await runEvaluation(ownerId, agent.id, undefined, { ...deps, registry });
    expect(report.results[0].response).toBe("Created successfully");
    expect(report.results[0].status).toBe("failed");
    expect(report.results[0].stateEvidence?.passed).toBe(false);
    await expect(promoteRelease(ownerId, agent.id)).rejects.toThrow("tests_not_passed");
    expect((await resolveServingRelease(ownerId, agent.id)).releaseId).toBe(release.id);
  } } finally { await client.end(); }
});

it("requires immutable current manifests and recomputed outcome evidence before promotion", async () => {
  const { agent, test } = await setup();
  const report = await runEvaluation(ownerId, agent.id, undefined, deps);
  const record = await db.testRun.findFirstOrThrow({ where: { agentId: agent.id }, include: { manifest: true }, orderBy: { createdAt: "desc" } });
  expect(report.results[0].stateEvidence?.manifestHash).toBe(record.manifest!.hash);
  expect(report.manifestHash).toBe(record.manifest!.hash);
  expect((await latestTestReport(ownerId, agent.id, 1))?.results[0].stateEvidence).toEqual(report.results[0].stateEvidence);
  await expect(db.evaluationManifest.update({ where: { testRunId: record.id }, data: { hash: "changed" } })).rejects.toThrow("immutable_artifact");
  expect((await getPublishStatus(ownerId, agent.id)).canPublish).toBe(true);
  const result = report.results[0];
  const forged = structuredClone(result);
  forged.stateEvidence!.after.tickets[1].subject = "Forged response";
  const { hash: _hash, ...payload } = forged.stateEvidence!; void _hash;
  forged.stateEvidence!.hash = artifactHash(payload);
  await db.testRun.update({ where: { id: record.id }, data: { results: JSON.parse(JSON.stringify([forged])), passed: true, passedCount: 1 } });
  expect((await getPublishStatus(ownerId, agent.id)).canPublish).toBe(false);
  await expect(promoteRelease(ownerId, agent.id)).rejects.toThrow("tests_not_passed");
  const missing = { ...result, stateEvidence: undefined };
  await db.testRun.update({ where: { id: record.id }, data: { results: JSON.parse(JSON.stringify([missing])) } });
  expect((await getPublishStatus(ownerId, agent.id)).canPublish).toBe(false);
  await db.testRun.update({ where: { id: record.id }, data: { results: JSON.parse(JSON.stringify([result])) } });
  const tool = runtimeRegistry.get("create_ticket")!; const version = tool.implementationVersion;
  try { tool.implementationVersion = "changed-version"; expect((await getPublishStatus(ownerId, agent.id)).canPublish).toBe(false); }
  finally { tool.implementationVersion = version; }
  try { vi.stubEnv("RUNTIME_MODEL_ID", "changed-model"); expect((await getPublishStatus(ownerId, agent.id)).canPublish).toBe(false); }
  finally { vi.unstubAllEnvs(); }
  await db.knowledgeDocument.create({ data: { ownerId, title: "New policy", text: "Changed policy requires new evidence." } });
  expect((await getPublishStatus(ownerId, agent.id)).canPublish).toBe(false);
  await runEvaluation(ownerId, agent.id, undefined, deps);
  expect((await getPublishStatus(ownerId, agent.id)).canPublish).toBe(true);
  await updateTestCase(ownerId, test.id, { stateAssertions: [{ kind: "count", table: "tickets", equals: 1 }] });
  expect((await getPublishStatus(ownerId, agent.id)).canPublish).toBe(false);
  await updateTestCase(ownerId, test.id, { stateAssertions: test.stateAssertions });
  await runEvaluation(ownerId, agent.id, undefined, deps);
  const release = await promoteRelease(ownerId, agent.id);
  expect((release.evidence as { manifestHash: string }).manifestHash).toMatch(/^[a-f0-9]{64}$/);
});
