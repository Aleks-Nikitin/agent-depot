import "dotenv/config";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../../db/prisma";
import { supportAgent } from "../fixtures";
import { PrismaRunStore } from "./prisma-store";
import type { Checkpoint } from "../runtime/state";
import type { PrismaClient } from "../../../generated/prisma/client";

const db = getDb();
const store = new PrismaRunStore(db);
const created: string[] = [];
const state: Checkpoint = { schemaVersion: 1, messages: [], pending: [], seenCallIds: [], writeCalls: 0, modelCalls: 1, toolCalls: 0,
  usage: { inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0.001 }, startedAt: Date.now(), activeMs: 1, approvalMode: "human", driverKey: "test" };
afterAll(async () => {
  await db.agentRun.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});
it("persists checkpoints and atomically grants only one concurrent approval claim", async () => {
  const run = await store.createRun(supportAgent, state); created.push(run.id);
  const call = { toolCallId: "write-1", toolId: "create_ticket", input: { subject: "test" } };
  const paused = await store.pauseForApproval(run.id, "demo", 0, { ...state, pending: [call] }, call);
  expect(await db.runtimeMetric.count({ where: { runId: run.id } })).toBe(0);
  await expect(store.loadRun(run.id, "someone-else")).rejects.toThrow("run_not_found");
  await expect(store.claimApproval(paused.approval.id, "someone-else", true)).rejects.toThrow("approval_not_found");
  const claims = await Promise.allSettled([
    new PrismaRunStore(db).claimApproval(paused.approval.id, "demo", true),
    new PrismaRunStore(db).claimApproval(paused.approval.id, "demo", true),
  ]);
  expect(claims.filter(c => c.status === "fulfilled")).toHaveLength(1);
  const loaded = await store.loadRun(run.id, "demo");
  expect(loaded.state.modelCalls).toBe(1);
  expect(loaded.state.pending).toEqual([call]);
  await expect(store.saveCheckpoint(run.id, "demo", 0, state)).rejects.toThrow("stale_checkpoint");
  const history = await store.history(run.id, "demo");
  expect(history.events.map(e => e.sequence)).toEqual([1, 2]);
  expect(history).not.toHaveProperty("checkpoint");
});
it("atomically records one metrics row for each terminal outcome without private execution data", async () => {
  for (const status of ["completed", "blocked", "failed"] as const) {
    const run = await store.createRun(supportAgent, state); created.push(run.id);
    const terminalState = status === "failed" ? { ...state, usage: { inputTokens: null, outputTokens: null, estimatedCostUsd: null } } : state;
    await store.finishRun(run.id, "demo", 0, terminalState, status, status === "completed" ? "Private response" : null, status === "completed" ? null : "test_reason");
    const saved = await db.runtimeMetric.findMany({ where: { runId: run.id } });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ ownerId: "demo", agentId: supportAgent.id, agentVersion: supportAgent.version,
      modelProfile: "test", status, activeMs: 1, modelCalls: 1, toolCalls: 0, ...terminalState.usage });
    expect(saved[0].finishedAt).toEqual((await store.loadRun(run.id, "demo")).finishedAt);
    for (const privateField of ["checkpoint", "messages", "input", "output", "response", "configSnapshot"]) {
      expect(saved[0]).not.toHaveProperty(privateField);
    }
    await expect(store.finishRun(run.id, "demo", 0, terminalState, status, null, "duplicate")).rejects.toThrow("stale_checkpoint");
    expect(await db.runtimeMetric.count({ where: { runId: run.id } })).toBe(1);
  }
});
it("rolls back terminal state and event when metrics insertion fails", async () => {
  const run = await store.createRun(supportAgent, state); created.push(run.id);
  const failing = db.$extends({ query: { runtimeMetric: { async create() { throw new Error("metrics_write_failed"); } } } });
  await expect(new PrismaRunStore(failing as unknown as PrismaClient).finishRun(run.id, "demo", 0, state, "completed", "test", null)).rejects.toThrow("metrics_write_failed");
  expect((await store.loadRun(run.id, "demo")).status).toBe("running");
  expect(await db.runEvent.count({ where: { runId: run.id } })).toBe(0);
  expect(await db.runtimeMetric.count({ where: { runId: run.id } })).toBe(0);
});
it("rejects expired approvals without changing pending state", async () => {
  const run = await store.createRun(supportAgent, state); created.push(run.id);
  const paused = await store.pauseForApproval(run.id, "demo", 0, state, { toolCallId: "expired", toolId: "create_ticket", input: {} });
  await db.approval.update({ where: { id: paused.approval.id }, data: { expiresAt: new Date(0) } });
  await expect(store.claimApproval(paused.approval.id, "demo", true)).rejects.toThrow("approval_unavailable");
  expect((await store.loadRun(run.id, "demo")).status).toBe("waiting_approval");
});
