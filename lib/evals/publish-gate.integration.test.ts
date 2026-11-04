import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { getDb } from "../db/prisma";
import { supportAgent } from "../agents/fixtures";
import { runEvaluation } from "./runner";
import { PrismaRunStore } from "../agents/storage/prisma-store";
import { runtimeRegistry } from "../integrations/runtime-tools";
import { graphCheckpointer } from "../agents/runtime/checkpointer";
import { getPublishStatus, latestTestRun } from "./publish-gate";

// Runs against the local Postgres (npm run test:integration). Uses its own agent and removes everything afterwards.
const db = getDb();
const agentId = `publish-gate-it-${randomUUID()}`;
let minutes = 0;
const at = () => new Date(Date.UTC(2026, 9, 25, 12, minutes++)); // strictly increasing createdAt

async function run(agentVersion: number, passedCount: number, totalCount = 5) {
  void totalCount;
  await db.agent.update({ where: { id: agentId }, data: { version: agentVersion, config: { ...supportAgent, id: agentId, version: agentVersion } } });
  let index = 0;
  try {
    await runEvaluation("demo", agentId, undefined, { store: new PrismaRunStore(db), registry: runtimeRegistry, driver: {
      key: "publish-gate-fixture", estimate: () => 0.00001, turn: async () => ({ text: index++ < passedCount ? "passed" : "failed", calls: [], messages: [], inputTokens: 1, outputTokens: 1 }),
    } });
    const saved = await db.testRun.findFirstOrThrow({ where: { agentId, agentVersion }, orderBy: { createdAt: "desc" } });
    return await db.testRun.update({ where: { id: saved.id }, data: { createdAt: at() } });
  } finally { await db.agent.update({ where: { id: agentId }, data: { version: 2, config: { ...supportAgent, id: agentId, version: 2 } } }); }
}

beforeEach(async () => {
  await db.testRun.deleteMany({ where: { agentId } });
  await db.testCase.deleteMany({ where: { agentId } });
  await db.agent.deleteMany({ where: { id: agentId } });
  await db.agent.create({ data: { id: agentId, ownerId: "demo", name: "Publish gate IT", version: 2, config: { ...supportAgent, id: agentId, version: 2 } } });
  for (const version of [1, 2]) await db.agentDraft.create({ data: { agentId, version, name: "Publish gate IT", config: { ...supportAgent, id: agentId, version } } });
  for (let i = 0; i < 5; i++) await db.testCase.create({ data: { agentId, input: `Can I return jacket ${i}?`, mustContain: ["passed"] } });
});
afterAll(async () => {
  await db.testRun.deleteMany({ where: { agentId } }); // TestRun has no relation, so delete explicitly
  await db.agent.deleteMany({ where: { id: agentId } });
  const runs = await db.agentRun.findMany({ where: { agentId }, select: { id: true } });
  for (const run of runs) await (await graphCheckpointer()).deleteThread(run.id);
  await db.agentRun.deleteMany({ where: { agentId } });
  await db.$disconnect();
});

it("is locked when the current version has no test run", async () => {
  expect(await getPublishStatus("demo", agentId)).toEqual({ canPublish: false, reason: "No test run for this version yet",
    agentVersion: 2, passedCount: 0, totalCount: 0, lastRunAt: null });
});

it("is locked when the latest run for the version failed", async () => {
  await run(2, 5);
  await run(2, 4);
  expect(await getPublishStatus("demo", agentId)).toMatchObject({ canPublish: false, reason: "1 test failing", passedCount: 4, totalCount: 5 });
});

it("unlocks when the latest run passed after an earlier failure", async () => {
  await run(2, 3);
  const latest = await run(2, 5);
  expect(await getPublishStatus("demo", agentId)).toEqual({ canPublish: true, reason: "All 5 tests passed", agentVersion: 2,
    passedCount: 5, totalCount: 5, lastRunAt: latest.createdAt.toISOString() });
  expect((await latestTestRun("demo", agentId, 2))?.id).toBe(latest.id);
});

it("does not let a pass on an older version unlock a newer one", async () => {
  await run(1, 5);
  expect(await getPublishStatus("demo", agentId)).toMatchObject({ canPublish: false, reason: "No test run for this version yet", agentVersion: 2 });
  expect(await getPublishStatus("demo", agentId, 1)).toMatchObject({ canPublish: true, agentVersion: 1 });
});

it("is locked when the agent has no test cases, even with a passing run", async () => {
  await run(2, 5);
  await db.testCase.deleteMany({ where: { agentId } });
  expect(await getPublishStatus("demo", agentId)).toMatchObject({ canPublish: false, reason: "Add at least one test before publishing" });
});

it("pluralizes failures and reports a missing agent", async () => {
  await run(2, 2);
  expect((await getPublishStatus("demo", agentId)).reason).toBe("3 tests failing");
  await expect(getPublishStatus("demo", "no-such-agent")).rejects.toThrow("agent_not_found");
});
