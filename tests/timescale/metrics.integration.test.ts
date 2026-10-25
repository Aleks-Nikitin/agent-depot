import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../../lib/db/prisma";
import { supportAgent } from "../../lib/agents/fixtures";
import { PrismaRunStore } from "../../lib/agents/storage/prisma-store";
import { queryRuntimeMetrics } from "../../lib/agents/storage/metrics";
import type { Checkpoint } from "../../lib/agents/runtime/state";

const db = getDb();
const store = new PrismaRunStore(db);
const created: string[] = [];
const ownerId = `timescale-${randomUUID()}`;
afterAll(async () => { await db.agentRun.deleteMany({ where: { id: { in: created } } }); await db.$disconnect(); });
async function finish(agentId: string, finishedAt: Date, unknown = false) {
  const state: Checkpoint = { schemaVersion: 1, messages: [], pending: [], seenCallIds: [], writeCalls: 0, modelCalls: 1, toolCalls: 0,
    usage: { inputTokens: unknown ? null : 10, outputTokens: unknown ? null : 5, estimatedCostUsd: unknown ? null : 0.001 },
    startedAt: Date.now(), activeMs: 50, approvalMode: "human", driverKey: "test" };
  const run = await store.createRun({ ...supportAgent, id: agentId, ownerId }, state); created.push(run.id);
  await store.finishRun(run.id, ownerId, 0, state, "completed", "Private answer", null);
  await db.runtimeMetric.updateMany({ where: { runId: run.id }, data: { finishedAt } });
}
it("uses an actual hypertable and continuous aggregate with fresh and materialized data", async () => {
  expect(await db.$queryRaw`SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'RuntimeMetric'`).toHaveLength(1);
  const from = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
  const current = new Date(from.getTime() + 3_600_000);
  const to = new Date(current.getTime() + 3_600_000);
  await finish("agent-a", new Date(from.getTime() + 1000));
  await db.$executeRaw`CALL refresh_continuous_aggregate('runtime_metrics_hourly', ${from}::timestamptz, ${current}::timestamptz)`;
  await finish("agent-a", new Date(current.getTime() + 1000));
  await finish("agent-b", new Date(current.getTime() + 2000), true);
  const window = { ownerId, from, to };
  const actual = await queryRuntimeMetrics(db, window, "timescale");
  expect(actual.buckets).toEqual((await queryRuntimeMetrics(db, window, "postgres")).buckets);
  expect(actual.buckets).toHaveLength(2);
  expect(actual.buckets[1]).toMatchObject({ runs: 2, unknownUsageRuns: 1, knownEstimatedCostUsd: 0.001 });
  expect((await queryRuntimeMetrics(db, { ...window, agentId: "agent-b" }, "timescale")).buckets).toHaveLength(1);
  expect((await queryRuntimeMetrics(db, { ...window, ownerId: "other" }, "timescale")).buckets).toEqual([]);
  expect((await queryRuntimeMetrics(db, { ...window, agentId: "' OR TRUE --" }, "timescale")).buckets).toEqual([]);
});
