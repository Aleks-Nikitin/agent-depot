import "dotenv/config";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../../db/prisma";
import { supportAgent } from "../fixtures";
import { PrismaRunStore } from "./prisma-store";
import type { Checkpoint } from "../runtime/state";

const db = getDb();
const store = new PrismaRunStore(db);
const created: string[] = [];
const state: Checkpoint = { schemaVersion: 1, messages: [], pending: [], seenCallIds: [], modelCalls: 1, toolCalls: 0,
  usage: { inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0.001 }, startedAt: Date.now(), activeMs: 1, approvalMode: "human" };
afterAll(async () => {
  await db.agentRun.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});
it("persists checkpoints and atomically grants only one concurrent approval claim", async () => {
  const run = await store.createRun(supportAgent, state); created.push(run.id);
  const call = { toolCallId: "write-1", toolId: "create_ticket", input: { subject: "test" } };
  const paused = await store.pauseForApproval(run.id, "demo", 0, { ...state, pending: [call] }, call);
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
it("rejects expired approvals without changing pending state", async () => {
  const run = await store.createRun(supportAgent, state); created.push(run.id);
  const paused = await store.pauseForApproval(run.id, "demo", 0, state, { toolCallId: "expired", toolId: "create_ticket", input: {} });
  await db.approval.update({ where: { id: paused.approval.id }, data: { expiresAt: new Date(0) } });
  await expect(store.claimApproval(paused.approval.id, "demo", true)).rejects.toThrow("approval_unavailable");
  expect((await store.loadRun(run.id, "demo")).status).toBe("waiting_approval");
});
