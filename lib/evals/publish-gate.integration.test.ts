import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { getDb } from "../db/prisma";
import { supportAgent } from "../agents/fixtures";
import { artifactHash } from "../agents/releases/fingerprint";
import { captureProviderSettings } from "../agents/releases/provider-settings";
import { testFingerprint } from "./fingerprint";
import { getPublishStatus, latestTestRun } from "./publish-gate";

// Runs against the local Postgres (npm run test:integration). Uses its own agent and removes everything afterwards.
const db = getDb();
const agentId = `publish-gate-it-${randomUUID()}`;
let minutes = 0;
const at = () => new Date(Date.UTC(2026, 9, 25, 12, minutes++)); // strictly increasing createdAt

async function run(agentVersion: number, passedCount: number, totalCount = 5) {
  const config = { ...supportAgent, id: agentId, version: agentVersion };
  const cases = await db.testCase.findMany({ where: { agentId }, orderBy: { id: "asc" } });
  return db.testRun.create({ data: { agentId, agentVersion,
    results: cases.map((test, i) => ({ testCaseId: test.id, status: i < passedCount ? "passed" : "failed", failures: [] })),
    configHash: artifactHash(config), providerSettings: captureProviderSettings(config),
    testsFingerprint: testFingerprint(cases), passed: passedCount === totalCount, passedCount, totalCount, finishedAt: at(), createdAt: at() } });
}

beforeEach(async () => {
  await db.testRun.deleteMany({ where: { agentId } });
  await db.testCase.deleteMany({ where: { agentId } });
  await db.agent.deleteMany({ where: { id: agentId } });
  await db.agent.create({ data: { id: agentId, ownerId: "demo", name: "Publish gate IT", version: 2, config: { ...supportAgent, id: agentId, version: 2 } } });
  for (const version of [1, 2]) await db.agentDraft.create({ data: { agentId, version, name: "Publish gate IT", config: { ...supportAgent, id: agentId, version } } });
  for (let i = 0; i < 5; i++) await db.testCase.create({ data: { agentId, input: `Can I return jacket ${i}?`, mustCall: ["knowledge_search"] } });
});
afterAll(async () => {
  await db.testRun.deleteMany({ where: { agentId } }); // TestRun has no relation, so delete explicitly
  await db.agent.deleteMany({ where: { id: agentId } });
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
