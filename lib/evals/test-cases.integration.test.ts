import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ZodError } from "zod";
import { getDb } from "../db/prisma";
import { supportAgent } from "../agents/fixtures";
import { createTestCase, createTestCasesFromDraft, deleteTestCase, listTestCases, updateTestCase } from "./test-cases";

// Runs against the local Postgres (npm run test:integration). Creates its own agent and removes it afterwards.
const db = getDb();
const agentId = `test-cases-it-${randomUUID()}`;

beforeAll(async () => {
  await db.agent.create({ data: { id: agentId, ownerId: "demo", name: "Test cases IT", version: 1, config: { ...supportAgent, id: agentId } } });
});
afterAll(async () => {
  await db.agent.deleteMany({ where: { id: agentId } }); // cascades to its test cases
  await db.$disconnect();
});

it("creates, lists, updates and deletes a test case", async () => {
  const created = await createTestCase("demo", agentId, { input: " Can I return a jacket after 20 days? ", mustCall: ["knowledge_search"], mustContain: ["30 days"] });
  expect(created).toMatchObject({ input: "Can I return a jacket after 20 days?", mustCall: ["knowledge_search"], mustNotCall: [], source: "user", useGrader: false });
  expect((await listTestCases("demo", agentId)).map(t => t.id)).toEqual([created.id]);

  const updated = await updateTestCase("demo", created.id, { mustNotCall: ["send_email"], useGrader: true });
  expect(updated).toMatchObject({ id: created.id, input: created.input, mustCall: ["knowledge_search"], mustNotCall: ["send_email"], useGrader: true });
  expect((await listTestCases("demo", agentId))[0]).toEqual(updated);

  await deleteTestCase("demo", created.id);
  expect(await listTestCases("demo", agentId)).toEqual([]);
});

it("validates input and rejects contradictory updates without saving them", async () => {
  await expect(createTestCase("demo", agentId, { input: "" })).rejects.toBeInstanceOf(ZodError);
  const t = await createTestCase("demo", agentId, { input: "q", mustCall: ["send_email"] });
  await expect(updateTestCase("demo", t.id, { mustNotCall: ["send_email"] })).rejects.toBeInstanceOf(ZodError);
  expect((await listTestCases("demo", agentId)).find(x => x.id === t.id)?.mustNotCall).toEqual([]);
  await deleteTestCase("demo", t.id);
});

it("reports a missing agent or test case", async () => {
  await expect(createTestCase("demo", "no-such-agent", { input: "q" })).rejects.toThrow("agent_not_found");
  await expect(listTestCases("demo", "no-such-agent")).rejects.toThrow("agent_not_found");
  await expect(updateTestCase("demo", "no-such-test", { input: "q" })).rejects.toThrow("test_not_found");
  await expect(deleteTestCase("demo", "no-such-test")).rejects.toThrow("test_not_found");
});

it("saves draft suggestions as gemini, including the draft's { input, expectedBehavior } shape", async () => {
  const saved = await createTestCasesFromDraft("demo", agentId, [
    { input: "How long does shipping take?", mustCall: ["knowledge_search"], mustContain: ["business days"] },
    { input: "Do you price match?", expectedBehavior: "Says price matching is not in the policy." },
  ]);
  expect(saved.map(t => [t.source, t.useGrader])).toEqual([["gemini", false], ["gemini", true]]);
  await expect(createTestCasesFromDraft("demo", agentId, [{ input: "ok" }, { input: "" }])).rejects.toBeInstanceOf(ZodError);
  expect(await listTestCases("demo", agentId)).toHaveLength(2); // the invalid batch saved nothing
  for (const t of saved) await deleteTestCase("demo", t.id);
});
