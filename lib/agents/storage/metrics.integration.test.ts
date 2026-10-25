import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../../db/prisma";
import { supportAgent } from "../fixtures";
import { PrismaRunStore } from "./prisma-store";
import { queryRuntimeMetrics } from "./metrics";
import type { Checkpoint } from "../runtime/state";

const db = getDb();
const store = new PrismaRunStore(db);
const created: string[] = [];
const ownerId = `metrics-${randomUUID()}`;
const from = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
const to = new Date(from.getTime() + 3_600_000);
afterAll(async () => { await db.agentRun.deleteMany({ where: { id: { in: created } } }); await db.$disconnect(); });
it("queries isolated hourly outcomes and known usage without exposing run contents", async () => {
  for (const [index, status] of (["completed", "blocked", "failed"] as const).entries()) {
    const state: Checkpoint = { schemaVersion: 1, messages: [], pending: [], seenCallIds: [], writeCalls: 0, modelCalls: 2, toolCalls: 1,
      usage: index === 2 ? { inputTokens: null, outputTokens: null, estimatedCostUsd: null }
        : { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001 },
      startedAt: Date.now(), activeMs: 100, approvalMode: "human", driverKey: "test" };
    const run = await store.createRun({ ...supportAgent, ownerId, id: `agent-${index % 2}` }, state); created.push(run.id);
    await store.finishRun(run.id, ownerId, 0, state, status, status === "completed" ? "Private answer" : null, status === "completed" ? null : "test");
    // Fix the fixture time even if the real clock crosses an hour boundary.
    await db.runtimeMetric.updateMany({ where: { runId: run.id }, data: { finishedAt: new Date(from.getTime() + 1000) } });
  }
  const result = await queryRuntimeMetrics(db, { ownerId, from, to }, "postgres");
  expect(result.buckets).toEqual([{ bucket: from.toISOString(), runs: 3, completed: 1, blocked: 1, failed: 1,
    activeMsTotal: 300, averageActiveMs: 100, modelCalls: 6, toolCalls: 3,
    knownInputTokens: 20, knownOutputTokens: 10, knownEstimatedCostUsd: 0.002, unknownUsageRuns: 1 }]);
  expect((await queryRuntimeMetrics(db, { ownerId: "other", from, to }, "postgres")).buckets).toEqual([]);
  expect((await queryRuntimeMetrics(db, { ownerId, agentId: "agent-1", from, to }, "postgres")).buckets[0].runs).toBe(1);
  expect((await queryRuntimeMetrics(db, { ownerId, agentId: "' OR TRUE --", from, to }, "postgres")).buckets).toEqual([]);
  expect((await queryRuntimeMetrics(db, { ownerId, from: to, to: new Date(to.getTime() + 3_600_000) }, "postgres")).buckets).toEqual([]);
});
it("rejects unbounded, partial-hour and reversed windows before querying", async () => {
  for (const window of [
    { ownerId, from: to, to: from },
    { ownerId, from, to: new Date(from.getTime() + 32 * 24 * 3_600_000) },
    { ownerId, from: new Date(from.getTime() + 1), to },
    { ownerId: "", from, to },
  ]) await expect(queryRuntimeMetrics(db, window, "postgres")).rejects.toThrow();
});
