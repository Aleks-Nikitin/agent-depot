import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../../db/prisma";
import { createAgent, duplicateAgent, getAgent, rollbackAgent, updateAgent } from "./store";
import { listTestCases } from "../../evals/test-cases";
import { getPublishStatus } from "../../evals/publish-gate";

const db = getDb();
const owner = `library-integration-${randomUUID()}`;
const input = { name: "Saved configuration", instructions: "Answer from knowledge.", model: "gemini", enabledTools: ["knowledge_search"] };
afterAll(async () => { await db.agent.deleteMany({ where: { ownerId: owner } }); await db.$disconnect(); });

it("serializes revision saves and restores exact permissions and limits as a new version", async () => {
  const initial = await createAgent(owner, { ...input, limits: { maxModelCalls: 3, maxEstimatedCostUsd: 0.01 } });
  await Promise.all([updateAgent(owner, initial.id, { ...input, name: "Revision A" }), updateAgent(owner, initial.id, { ...input, name: "Revision B" })]);
  const edited = await getAgent(owner, initial.id);
  expect(edited.version).toBe(3);
  expect(edited.versions.map(v => v.version)).toEqual([3, 2, 1]);
  const restored = await rollbackAgent(owner, initial.id, 1);
  expect(restored).toMatchObject({ version: 4, config: { name: input.name, version: 4, enabledTools: ["knowledge_search"], limits: { maxModelCalls: 3, maxEstimatedCostUsd: 0.01 } } });
  expect((await getPublishStatus(owner, initial.id)).canPublish).toBe(false);
  await expect(rollbackAgent("another-owner", initial.id, 1)).rejects.toThrow("agent_not_found");
});

it("duplicates configuration and reviewed cases without copying release evidence", async () => {
  const initial = await createAgent(owner, { ...input, testCases: [{ input: "How long?", useGrader: true, expectedBehavior: "Use the saved policy." }] });
  const copied = await duplicateAgent(owner, initial.id);
  expect(copied).toMatchObject({ version: 1, published: false, name: `${input.name} (copy)` });
  const originalCases = await listTestCases(owner, initial.id);
  const cases = await listTestCases(owner, copied.id);
  expect(cases[0]).toMatchObject({ input: "How long?", useGrader: true, expectedBehavior: "Use the saved policy." });
  expect(cases[0].id).not.toBe(originalCases[0].id);
  expect((await getPublishStatus(owner, copied.id)).canPublish).toBe(false);
});
