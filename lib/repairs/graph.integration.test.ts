import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { createAgent, updateAgent } from "@/lib/agents/library/store";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { ModelDriver, ModelTurn } from "@/lib/agents/runtime/model";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import { runEvaluation } from "@/lib/evals/runner";
import { createTestCase } from "@/lib/evals/test-cases";
import { promoteRelease } from "@/lib/agents/releases/promote";
import { previewRegression, saveRegression } from "./regression";
import { startRepair, decideRepair, ownedRepair, cancelRepair, repairView } from "./service";
import { processRepair } from "./worker";
import { repairCheckpointer, repairThread } from "./checkpointer";
import { processExecutionJob } from "@/lib/jobs/worker";
if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb(); const owner = `repair-graph-${randomUUID()}`;
const input = { name: "Reviewed repair", instructions: "Support baseline", model: "gemini", enabledTools: ["create_ticket"] };
const turn = (text: string, calls: ModelTurn["calls"] = []): ModelTurn => ({ text, calls, messages: [], inputTokens: 1, outputTokens: 1 });
const driver: ModelDriver = { key: "repair-fixture", estimate: () => 0.00001, turn: async (config, messages) => {
  const question = String(messages.find(m => m.role === "user")?.content);
  if (question === "Say hello") return turn("Hello");
  if (messages.some(m => m.role === "tool")) return turn("Ticket created");
  if (config.instructions.startsWith("broken") && !config.instructions.includes("Reviewed regression requirement:")) return turn("Ticket created");
  return turn("", [{ toolId: "create_ticket", toolCallId: "ticket", input: { subject: "Repair review 1042" } }]);
} };
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver };
async function reproduction() {
  const agent = await createAgent(owner, input);
  await createTestCase(owner, agent.id, { input: "Say hello", mustContain: ["Hello"] });
  await updateAgent(owner, agent.id, { ...input, instructions: "broken: pretend ticket success" });
  // A completed runtime can still have a failed business outcome.
  const run = await db.agentRun.create({ data: { ownerId: owner, agentId: agent.id, configSnapshot: (await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).config!,
    agentVersion: 2, source: "playground", input: "Open Repair review 1042", status: "completed", response: "Ticket created", finishedAt: new Date() } });
  const preview = await previewRegression(owner, run.id);
  await saveRegression(owner, run.id, { sourceHash: preview.sourceHash, definition: { ...preview.definition, expectedBehavior: "Actually create exactly one Repair review 1042 ticket before confirming success.",
    mustCall: ["create_ticket"], fixtures: { tickets: [] }, stateAssertions: [{ kind: "count", table: "tickets", equals: 1 }, { kind: "record", table: "tickets", fields: { subject: "Repair review 1042" } }] } });
  return { agent, run };
}
afterAll(async () => {
  for (const c of await db.repairCase.findMany({ where: { ownerId: owner } })) await repairCheckpointer().deleteThread(repairThread(c.id));
  for (const run of await db.agentRun.findMany({ where: { ownerId: owner } })) await (await graphCheckpointer()).deleteThread(run.id);
  for (const j of await db.executionJob.findMany({ where: { ownerId: owner } })) await db.$queryRaw`SELECT graphile_worker.remove_job(${j.id})`;
  for (const c of await db.repairCase.findMany({ where: { ownerId: owner } })) for (const phase of ["start", "decision", ...c.childJobIds.map(id => `result-${id}`)]) await db.$queryRaw`SELECT graphile_worker.remove_job(${`repair:${c.id}:${phase}`})`;
  await db.executionJob.deleteMany({ where: { ownerId: owner } });
  await db.testRun.deleteMany({ where: { agentId: { in: (await db.agent.findMany({ where: { ownerId: owner } })).map(a => a.id) } } });
  await db.agentRun.deleteMany({ where: { ownerId: owner } }); await db.agent.deleteMany({ where: { ownerId: owner } });
  await db.workspace.deleteMany({ where: { ownerId: owner } }); await db.$disconnect();
});
it("persists review across graph instances, recovers a crash after draft commit exactly once, retests baseline and promotes v3", async () => {
  const { agent, run } = await reproduction(); const live = await db.demoTicket.count();
  const failed = await runEvaluation(owner, agent.id, undefined, deps);
  expect(failed.results.map(r => r.status)).toEqual(["passed", "failed"]);
  const started = await startRepair(owner, run.id, deps, 2);
  expect(await startRepair(owner, run.id, deps, 2)).toEqual(started);
  await processRepair(started.id, deps); let c = await ownedRepair(owner, started.id);
  expect(c.status).toBe("review"); expect(c.appliedVersion).toBeNull();
  await expect(repairView("another-owner", c.id)).rejects.toThrow("repair_not_found");
  await expect(decideRepair(owner, c.id, { approved: true, proposalHash: "0".repeat(64) }, deps)).rejects.toThrow("repair_proposal_changed");
  await decideRepair(owner, c.id, { approved: true, proposalHash: c.proposalHash }, deps);
  await expect(processRepair(c.id, deps, { afterDraft: () => { throw new Error("simulated process loss"); } })).rejects.toThrow("simulated process loss");
  expect((await ownedRepair(owner, c.id)).appliedVersion).toBe(3);
  await processRepair(c.id, deps); c = await ownedRepair(owner, c.id);
  expect(c.status).toBe("evaluating"); expect(c.childJobId).toBeTruthy();
  await processRepair(c.id, deps);
  expect(await db.agentDraft.count({ where: { agentId: agent.id, version: 3 } })).toBe(1);
  await processExecutionJob(c.childJobId!, deps);
  await processRepair(c.id, deps);
  const repeated = await ownedRepair(owner, c.id); expect(repeated.status).toBe("evaluating");
  expect(repeated.childJobId).not.toBe(c.childJobId);
  await processExecutionJob(repeated.childJobId!, deps); await processRepair(c.id, deps);
  expect((await ownedRepair(owner, c.id)).status).toBe("verified");
  const view = await repairView(owner, c.id); expect(JSON.stringify(view)).not.toContain("checkpoint");
  const report = view.child!.result as unknown as { results: { status: string }[] };
  expect(report.results.map(r => r.status)).toEqual(["passed", "passed"]);
  await processRepair(c.id, deps); await processExecutionJob(c.childJobId!, deps);
  expect(await db.testRun.count({ where: { agentId: agent.id, agentVersion: 3 } })).toBe(2);
  const release = await promoteRelease(owner, agent.id); expect(release).toBeTruthy();
  expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).publishedVersion).toBe(3);
  expect(await db.demoTicket.count()).toBe(live);
}, 30_000);
it("rejects changed proposals, stale bases, expired and rejected reviews, cancellation and incompatible graph versions without applying", async () => {
  for (const mode of ["changed", "stale", "approved_stale", "approved_expired", "expired", "rejected", "cancelled", "version"]) {
    const { agent, run } = await reproduction(); const { id } = await startRepair(owner, run.id, deps);
    await processRepair(id, deps); const c = await ownedRepair(owner, id);
    if (mode === "changed") {
      await db.repairCase.update({ where: { id }, data: { payload: { ...(c.payload as object), invariant: "tampered" } } });
      await expect(decideRepair(owner, id, { approved: true, proposalHash: c.proposalHash }, deps)).rejects.toThrow("repair_proposal_changed");
    } else if (mode === "stale") {
      await updateAgent(owner, agent.id, { ...input, instructions: "concurrent edit" });
      await expect(decideRepair(owner, id, { approved: true, proposalHash: c.proposalHash }, deps)).rejects.toThrow("repair_base_changed");
    } else if (mode === "approved_stale" || mode === "approved_expired") {
      await decideRepair(owner, id, { approved: true, proposalHash: c.proposalHash }, deps);
      if (mode === "approved_stale") await updateAgent(owner, agent.id, { ...input, instructions: "edit after approval" });
      else await db.repairCase.update({ where: { id }, data: { expiresAt: new Date(0) } });
      await processRepair(id, deps); expect((await ownedRepair(owner, id)).status).toBe("failed");
    } else if (mode === "expired") {
      await db.repairCase.update({ where: { id }, data: { expiresAt: new Date(0) } });
      await expect(decideRepair(owner, id, { approved: true, proposalHash: c.proposalHash }, deps)).rejects.toThrow("repair_review_unavailable");
    } else if (mode === "rejected") {
      await decideRepair(owner, id, { approved: false, proposalHash: c.proposalHash }, deps); await processRepair(id, deps);
      expect((await ownedRepair(owner, id)).status).toBe("rejected");
      await expect(decideRepair(owner, id, { approved: true, proposalHash: c.proposalHash }, deps)).rejects.toThrow("repair_already_decided");
    } else if (mode === "cancelled") {
      await cancelRepair(owner, id); await processRepair(id, deps); expect((await ownedRepair(owner, id)).status).toBe("cancelled");
    } else {
      await db.repairCase.update({ where: { id }, data: { graphVersion: 2 } }); await processRepair(id, deps);
      expect((await ownedRepair(owner, id)).reason).toBe("repair_graph_incompatible");
    }
    expect((await ownedRepair(owner, id)).appliedVersion).toBeNull();
  }
}, 30_000);
it("retains applied separately from verified when workspace budget prevents the child evaluation", async () => {
  const { agent, run } = await reproduction(); const { id } = await startRepair(owner, run.id, deps);
  await processRepair(id, deps); const c = await ownedRepair(owner, id);
  await decideRepair(owner, id, { approved: true, proposalHash: c.proposalHash }, deps);
  await processRepair(id, deps); const applied = await ownedRepair(owner, id);
  const [{ day }] = await db.$queryRaw<{ day: string }[]>`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day`;
  await db.workspaceDay.upsert({ where: { ownerId_day: { ownerId: owner, day } }, create: { ownerId: owner, day, heldMicros: 1_000_000 }, update: { heldMicros: 1_000_000 } });
  await processExecutionJob(applied.childJobId!, deps); await processRepair(id, deps);
  expect((await ownedRepair(owner, id)).status).toBe("failed"); expect((await ownedRepair(owner, id)).appliedVersion).toBe(3);
  expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).servingReleaseId).toBeNull();
  const completed = await repairView(owner, id);
  expect(JSON.stringify(completed.child?.result)).toContain("evaluation_unavailable");
}, 30_000);
