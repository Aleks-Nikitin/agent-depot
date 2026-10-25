import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../db/prisma";
import { createAgent, publishAgent, updateAgent } from "../agents/library/store";
import { PrismaRunStore } from "../agents/storage/prisma-store";
import type { ModelDriver } from "../agents/runtime/model";
import { runtimeRegistry } from "../integrations/runtime-tools";
import { runEvaluation } from "./runner";
import { createTestCase, updateTestCase } from "./test-cases";
import { getPublishStatus } from "./publish-gate";

const db = getDb();
const owner = `evaluation-it-${randomUUID()}`;
const agents: string[] = [];
const input = { name: "Evaluation fixture", instructions: "Answer using allowed tools.", model: "gemini", enabledTools: ["knowledge_search", "send_email"] };
const driver: ModelDriver = { key: "evaluation-it", estimate: () => 0.00001,
  turn: async () => ({ text: "Returns are accepted within 30 days.", calls: [], messages: [], inputTokens: 1, outputTokens: 1 }) };
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver };
afterAll(async () => {
  await db.testRun.deleteMany({ where: { agentId: { in: agents } } });
  await db.agentRun.deleteMany({ where: { ownerId: owner } });
  await db.agent.deleteMany({ where: { ownerId: owner } });
  await db.$disconnect();
});
async function setup() { const agent = await createAgent(owner, input); agents.push(agent.id); return agent; }

it("runs the persisted engine and gates publication on the exact version and tests", async () => {
  const agent = await setup();
  await expect(publishAgent(owner, agent.id, true)).rejects.toThrow("tests_not_passed");
  const test = await createTestCase(owner, agent.id, { input: "Return policy?", mustContain: ["30 days"] });
  const report = await runEvaluation(owner, agent.id, undefined, deps);
  expect(report.results[0]).toMatchObject({ status: "passed", response: "Returns are accepted within 30 days." });
  const saved = await db.agentRun.findUniqueOrThrow({ where: { id: report.results[0].runId! } });
  expect(saved).toMatchObject({ source: "test", ownerId: owner, agentVersion: 1 });
  expect((await publishAgent(owner, agent.id, false)).publishedVersion).toBe(1);
  await updateTestCase(owner, test.id, { mustContain: ["90 days"] });
  expect(await getPublishStatus(owner, agent.id)).toMatchObject({ canPublish: false, reason: "Test cases changed. Run tests again" });
  expect((await runEvaluation(owner, agent.id, undefined, deps)).results[0].status).toBe("failed");
  await expect(publishAgent(owner, agent.id, true)).rejects.toThrow("tests_not_passed");
  await updateTestCase(owner, test.id, { mustContain: ["30 days"] });
  await runEvaluation(owner, agent.id, undefined, deps);
  await updateAgent(owner, agent.id, input);
  expect(await getPublishStatus(owner, agent.id)).toMatchObject({ canPublish: false, agentVersion: 2 });
  await expect(runEvaluation("other-owner", agent.id, undefined, deps)).rejects.toThrow("agent_not_found");
});

it("denies write tools during evaluation and still detects forbidden attempts", async () => {
  const agent = await setup();
  await createTestCase(owner, agent.id, { input: "Send an email", mustNotCall: ["send_email"] });
  let calls = 0;
  const writing: ModelDriver = { ...driver, turn: async () => ++calls === 1
    ? { text: "", messages: [], calls: [{ toolCallId: "email-test", toolId: "send_email", input: { to: "demo@example.test", subject: "Review", body: "Never executed" } }], inputTokens: 1, outputTokens: 1 }
    : driver.turn({} as never, [], [], new AbortController().signal) };
  const report = await runEvaluation(owner, agent.id, undefined, { ...deps, driver: writing });
  expect(report.results[0]).toMatchObject({ status: "failed", failures: ["called forbidden tool send_email"] });
  expect(await db.recordedEmail.count({ where: { ownerId: owner } })).toBe(0);
});

it("serializes simultaneous suites and limits test case count", async () => {
  const agent = await setup();
  for (let i = 0; i < 5; i++) await createTestCase(owner, agent.id, { input: `question ${i}` });
  await expect(createTestCase(owner, agent.id, { input: "sixth" })).rejects.toThrow("test_case_limit");
  let release!: () => void; let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const running = runEvaluation(owner, agent.id, undefined, { ...deps, driver: { ...driver, turn: async () => {
    started(); await blocked; return { text: "Done", calls: [], messages: [], inputTokens: 1, outputTokens: 1 };
  } } });
  await ready;
  try { await expect(runEvaluation(owner, agent.id, undefined, deps)).rejects.toThrow("evaluation_running"); }
  finally { release(); }
  expect((await running).results).toHaveLength(5);
});
