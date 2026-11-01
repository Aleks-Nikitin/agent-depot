import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { createAgent, updateAgent } from "../library/store";
import { PrismaRunStore } from "../storage/prisma-store";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { ModelDriver } from "../runtime/model";
import { runEvaluation } from "@/lib/evals/runner";
import { createTestCase, updateTestCase } from "@/lib/evals/test-cases";
import { promoteRelease, rollbackRelease } from "./promote";
import { resolveServingRelease } from "./resolve";
import { executeServing } from "./execute";

const db = getDb();
const ownerId = `releases-it-${randomUUID()}`;
const agents: string[] = [];
const input = { name: "Release fixture", instructions: "Approved response", model: "gemini", enabledTools: [] };
let calls = 0;
const driver: ModelDriver = { key: "releases-it", estimate: () => 0.00001, turn: async config => {
  calls++;
  return { text: config.instructions, calls: [], messages: [], inputTokens: 1, outputTokens: 1 };
} };
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver };
async function setup() {
  const agent = await createAgent(ownerId, input); agents.push(agent.id);
  const test = await createTestCase(ownerId, agent.id, { input: "Answer", mustContain: ["Approved"] });
  return { agent, test };
}
afterAll(async () => {
  await db.testRun.deleteMany({ where: { agentId: { in: agents } } });
  await db.agentRun.deleteMany({ where: { ownerId } });
  await db.agent.deleteMany({ where: { ownerId } });
  await db.workspace.deleteMany({ where: { ownerId } });
  await db.$disconnect();
});

it("isolates serving from broken drafts, promotes atomically and deduplicates execution", async () => {
  const { agent } = await setup();
  await expect(executeServing(ownerId, agent.id, "question", "before-release", deps)).rejects.toThrow("no_serving_release");
  await runEvaluation(ownerId, agent.id, undefined, deps);
  const first = await promoteRelease(ownerId, agent.id, 1);
  expect((await promoteRelease(ownerId, agent.id, 1)).id).toBe(first.id);
  await expect(db.agentRelease.update({ where: { id: first.id }, data: { version: 99 } })).rejects.toThrow("immutable_artifact");
  await expect(db.agentDraft.updateMany({ where: { agentId: agent.id }, data: { name: "modified" } })).rejects.toThrow("immutable_artifact");
  await updateAgent(ownerId, agent.id, { ...input, instructions: "Broken draft" });
  await runEvaluation(ownerId, agent.id, undefined, deps);
  await expect(promoteRelease(ownerId, agent.id, 2)).rejects.toThrow("tests_not_passed");
  expect((await resolveServingRelease(ownerId, agent.id)).config.version).toBe(1);
  const before = calls;
  const [a, b] = await Promise.all([executeServing(ownerId, agent.id, "question", "request-1", deps), executeServing(ownerId, agent.id, "question", "request-1", deps)]);
  expect(a.runId).toBe(b.runId);
  expect(calls - before).toBe(1);
  const completed = await executeServing(ownerId, agent.id, "question", "request-1", deps);
  expect(completed.response).toBe("Approved response");
  await expect(executeServing(ownerId, agent.id, "different", "request-1", deps)).rejects.toThrow("idempotency_key_conflict");
  await expect(resolveServingRelease("another-owner", agent.id)).rejects.toThrow("agent_not_found");
  await updateAgent(ownerId, agent.id, { ...input, instructions: "Approved v3" });
  await runEvaluation(ownerId, agent.id, undefined, deps);
  const third = await promoteRelease(ownerId, agent.id, 3);
  expect(third.id).not.toBe(first.id);
  expect((await executeServing(ownerId, agent.id, "question", "request-2", deps)).response).toBe("Approved v3");
  expect((await executeServing(ownerId, agent.id, "question", "request-1", deps)).runId).toBe(a.runId);
  const row = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
  await rollbackRelease(ownerId, agent.id, first.id, row.servingGeneration);
  expect((await resolveServingRelease(ownerId, agent.id)).config.version).toBe(1);
  await expect(rollbackRelease(ownerId, agent.id, third.id, row.servingGeneration)).rejects.toThrow("serving_release_changed");
});

it("rejects stale, incomplete and unavailable evidence without changing serving", async () => {
  const { agent, test } = await setup();
  await runEvaluation(ownerId, agent.id, undefined, deps);
  const release = await promoteRelease(ownerId, agent.id);
  await updateTestCase(ownerId, test.id, { input: "Changed question" });
  await expect(promoteRelease(ownerId, agent.id)).rejects.toThrow("tests_not_passed");
  await runEvaluation(ownerId, agent.id, undefined, deps);
  const run = await db.testRun.findFirstOrThrow({ where: { agentId: agent.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  for (const data of [{ results: [] }, { configHash: "stale" }, { status: "running" }, { passed: false }]) {
    await db.testRun.update({ where: { id: run.id }, data });
    await expect(promoteRelease(ownerId, agent.id)).rejects.toThrow("tests_not_passed");
    await db.testRun.update({ where: { id: run.id }, data: { results: run.results!, configHash: run.configHash, status: "completed", passed: true } });
  }
  await expect(promoteRelease(ownerId, agent.id, 999)).rejects.toThrow("draft_changed");
  await expect(rollbackRelease("another-owner", agent.id, release.id, 1)).rejects.toThrow("agent_not_found");
  expect((await resolveServingRelease(ownerId, agent.id)).releaseId).toBe(release.id);
});
