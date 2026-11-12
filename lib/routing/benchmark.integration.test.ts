import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { runAgent } from "@/lib/agents/runtime/run-agent";
import { createAgent, updateAgent } from "@/lib/agents/library/store";
import { createTestCase } from "@/lib/evals/test-cases";
import { latestTestReport, getPublishStatus } from "@/lib/evals/publish-gate";
import { runEvaluation } from "@/lib/evals/runner";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { ModelDriver } from "@/lib/agents/runtime/model";
import { processExecutionJob } from "@/lib/jobs/worker";
import { saveRouting, startBenchmark, cancelBenchmark } from "./service";
import { processBenchmark } from "./worker";
import { benchmarkView } from "./report";
import { selectRoute, type RoutingPolicy } from "./policy";
if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb(); const owner = `routing-it-${randomUUID()}`;
const policy: RoutingPolicy = { version: 1, mode: "lowest-estimated-cost", approvedProfiles: ["gemini-primary", "openai-fallback"], minContextTokens: 8192,
  allowedProviders: ["google", "openai"], dataPolicyTag: "synthetic", maxExpectedLatencyMs: 10000, maxCostTier: "standard" };
let calls = 0;
const driverForConfig = (config: Parameters<NonNullable<import("@/lib/agents/runtime/run-agent").RuntimeDependencies["driverForConfig"]>>[0]): ModelDriver => {
  const routing = selectRoute(config, process.env); const selected = routing?.selectedProfile ?? "gemini-primary";
  return { key: `fixture-${selected}`, routing: routing ?? undefined, contextTokens: routing?.candidates.find(c => c.id === selected)?.contextTokens,
    identity: { profile: selected, provider: selected === "gemini-primary" ? "google" : "openai", model: `fixture-${selected}` },
    estimate: () => selected === "gemini-primary" ? .0001 : .00001,
    turn: async (_config, messages) => {
      calls++;
      const question = String(messages.find(m => m.role === "user")?.content);
      if (question === "Create a ticket" && !messages.some(m => m.role === "tool")) return { text: "", calls: [{ toolId: "create_ticket", toolCallId: "ticket", input: { subject: "Measured result" } }], messages: [], inputTokens: 10, outputTokens: 10 };
      return { text: selected === "gemini-primary" ? "Hello" : "Hi", calls: [], messages: [], inputTokens: 10, outputTokens: 10 };
    } };
};
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver: { key: "unused", estimate: () => 0, turn: async () => { throw new Error("must select profile"); } } as ModelDriver, driverForConfig };
beforeAll(() => {
  vi.stubEnv("OPENAI_RUNTIME_MODEL_ID", "fixture-openai"); vi.stubEnv("OPENAI_RUNTIME_INPUT_USD_PER_MILLION", ".01"); vi.stubEnv("OPENAI_RUNTIME_OUTPUT_USD_PER_MILLION", ".04");
  vi.stubEnv("ROUTING_PROFILE_CATALOG", JSON.stringify({ "gemini-primary": { model: process.env.RUNTIME_MODEL_ID, contextTokens: 32000, tools: true, expectedLatencyMs: 1000, costTier: "standard", dataPolicyTag: "synthetic" },
    "openai-fallback": { model: "fixture-openai", contextTokens: 16000, tools: true, expectedLatencyMs: 2000, costTier: "economy", dataPolicyTag: "synthetic" } }));
});
afterAll(async () => {
  for (const run of await db.agentRun.findMany({ where: { ownerId: owner } })) await (await graphCheckpointer()).deleteThread(run.id);
  for (const j of await db.executionJob.findMany({ where: { ownerId: owner } })) await db.$queryRaw`SELECT graphile_worker.remove_job(${j.id})`;
  for (const b of await db.routingBenchmark.findMany({ where: { ownerId: owner } })) for (const phase of ["start", ...b.childJobIds]) await db.$queryRaw`SELECT graphile_worker.remove_job(${`benchmark:${b.id}:${phase}`})`;
  const agents = await db.agent.findMany({ where: { ownerId: owner } });
  await db.testRun.deleteMany({ where: { agentId: { in: agents.map(a => a.id) } } }); await db.executionJob.deleteMany({ where: { ownerId: owner } });
  await db.agentRun.deleteMany({ where: { ownerId: owner } }); await db.agent.deleteMany({ where: { ownerId: owner } });
  await db.workspace.deleteMany({ where: { ownerId: owner } }); vi.unstubAllEnvs(); await db.$disconnect();
});
async function setup() {
  const a = await createAgent(owner, { name: "Routing fixture", instructions: "Answer and create requested ticket", model: "gemini", enabledTools: ["create_ticket"] });
  await createTestCase(owner, a.id, { input: "Say hello", mustContain: ["Hello"] });
  await createTestCase(owner, a.id, { input: "Create a ticket", mustCall: ["create_ticket"], stateAssertions: [{ kind: "record", table: "tickets", fields: { subject: "Measured result" } }] });
  await saveRouting(owner, a.id, { expectedVersion: 1, routing: policy }); return a;
}
it("compares repeated identical isolated cases, persists routing reasons, includes quality failures and keeps certification separate", async () => {
  const a = await setup(); const baseline = await runEvaluation(owner, a.id, undefined, deps); // routed suite fails Hello check
  expect(baseline.results[0].status).toBe("failed"); const live = await db.demoTicket.count();
  const input = { expectedVersion: 2, repeats: 2, heldOutAcknowledged: true };
  const started = await startBenchmark(owner, a.id, "same", input, deps);
  expect(await startBenchmark(owner, a.id, "same", input, deps)).toEqual(started);
  await expect(benchmarkView("other-owner", started.id)).rejects.toThrow("benchmark_not_found");
  for (let i = 0; i < 4; i++) {
    await processBenchmark(started.id, deps); await processBenchmark(started.id, deps);
    const row = await db.routingBenchmark.findUniqueOrThrow({ where: { id: started.id } });
    expect(row.childJobIds).toHaveLength(i + 1); await processExecutionJob(row.activeJobId!, deps);
  }
  await processBenchmark(started.id, deps); await processBenchmark(started.id, deps);
  const report = await benchmarkView(owner, started.id); expect(report.status).toBe("completed");
  expect(report.arms[0]).toMatchObject({ arm: "primary", expected: 4, passed: 4, stateCorrect: 4 });
  expect(report.arms[1]).toMatchObject({ arm: "routed", expected: 4, passed: 2, behaviorFailures: 2, stateCorrect: 4 });
  expect(report.arms[1].costUsd!).toBeLessThan(report.arms[0].costUsd!);
  expect((await latestTestReport(owner, a.id, 2))?.ranAt).toBe(baseline.ranAt);
  expect((await getPublishStatus(owner, a.id)).canPublish).toBe(false);
  expect(await db.testRun.count({ where: { agentId: a.id, purpose: "benchmark" } })).toBe(4);
  expect((await db.agent.findUniqueOrThrow({ where: { id: a.id } })).version).toBe(2); expect(await db.demoTicket.count()).toBe(live);
  const event = await db.runEvent.findFirstOrThrow({ where: { run: { ownerId: owner }, type: "model_started" } });
  expect(JSON.stringify(event.payload)).toContain("lowest_declared_context_cost"); expect(calls).toBeGreaterThan(0);
  await updateAgent(owner, a.id, { name: a.config.name, instructions: "Revised instructions", model: "gemini", enabledTools: ["create_ticket"] });
  const next = await startBenchmark(owner, a.id, "next-version", { expectedVersion: 3, heldOutAcknowledged: true }, deps);
  expect((await benchmarkView(owner, next.id, started.id)).comparison).toMatchObject({ version: 2, compatible: true });
  await cancelBenchmark(owner, next.id);
  await createTestCase(owner, a.id, { input: "Changed workload" });
  const changed = await startBenchmark(owner, a.id, "different-workload", { expectedVersion: 3, heldOutAcknowledged: true }, deps);
  expect((await benchmarkView(owner, changed.id, started.id)).comparison).toMatchObject({ compatible: false, arms: [] });
  await cancelBenchmark(owner, changed.id);
}, 30_000);
it("rejects stale saves, changed comparison dependencies and cancellation without admitting extra child work", async () => {
  const a = await setup(); await expect(saveRouting(owner, a.id, { expectedVersion: 1, routing: policy })).rejects.toThrow("agent_version_changed");
  await saveRouting(owner, a.id, { expectedVersion: 2, routing: { ...policy, mode: "locked", lockedProfile: "gemini-primary" } });
  const passing = await startBenchmark(owner, a.id, "passing-shadow", { expectedVersion: 3, repeats: 1, heldOutAcknowledged: true }, deps);
  for (let i = 0; i < 2; i++) {
    await processBenchmark(passing.id, deps); const b = await db.routingBenchmark.findUniqueOrThrow({ where: { id: passing.id } });
    await processExecutionJob(b.activeJobId!, deps);
  }
  await processBenchmark(passing.id, deps);
  expect((await benchmarkView(owner, passing.id)).arms.map(a => a.passed)).toEqual([2, 2]);
  expect(await latestTestReport(owner, a.id, 3)).toBeNull(); expect((await getPublishStatus(owner, a.id)).canPublish).toBe(false);
  const { id } = await startBenchmark(owner, a.id, "cancel", { expectedVersion: 3, heldOutAcknowledged: true }, deps);
  await cancelBenchmark(owner, id); const count = calls; await processBenchmark(id, deps); expect(calls).toBe(count);
  const second = await startBenchmark(owner, a.id, "changed", { expectedVersion: 3, heldOutAcknowledged: true }, deps);
  await createTestCase(owner, a.id, { input: "Added after snapshot" });
  await expect(processBenchmark(second.id, deps)).rejects.toThrow("benchmark_dependencies_changed");
  expect((await db.routingBenchmark.findUniqueOrThrow({ where: { id: second.id } })).childJobIds).toHaveLength(0);
});

it("blocks actual context overflow before any billable attempt", async () => {
  const a = await setup();
  const catalog = JSON.parse(process.env.ROUTING_PROFILE_CATALOG!); catalog["openai-fallback"].contextTokens = 1024;
  vi.stubEnv("ROUTING_PROFILE_CATALOG", JSON.stringify(catalog));
  await saveRouting(owner, a.id, { expectedVersion: 2, routing: { ...policy, minContextTokens: 1024 } });
  const config = (await import("@/lib/agents/contracts")).AgentConfigSchema.parse((await db.agent.findUniqueOrThrow({ where: { id: a.id } })).config);
  const before = calls; const result = await runAgent({ config, ownerId: owner, message: "x".repeat(3000) }, deps);
  expect(result).toMatchObject({ status: "blocked", stopReason: "routing_context_limit" }); expect(calls).toBe(before);
  expect(await db.modelAttempt.count({ where: { runId: result.runId } })).toBe(0);
});
