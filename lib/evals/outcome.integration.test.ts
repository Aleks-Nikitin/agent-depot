import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { createAgent } from "@/lib/agents/library/store";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { ModelDriver } from "@/lib/agents/runtime/model";
import { createTestCase, updateTestCase } from "./test-cases";
import { runEvaluation } from "./runner";
import { getPublishStatus, latestTestReport } from "./publish-gate";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb(); const owner = `classification-it-${randomUUID()}`;
const driver: ModelDriver = { key: "classification-fixture", estimate: () => 0.00001,
  turn: async () => ({ text: "30 days", calls: [], messages: [], inputTokens: 1, outputTokens: 1 }) };
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver };
afterAll(async () => {
  for (const run of await db.agentRun.findMany({ where: { ownerId: owner } })) await (await graphCheckpointer()).deleteThread(run.id);
  await db.agentRun.deleteMany({ where: { ownerId: owner } });
  await db.agent.deleteMany({ where: { ownerId: owner } });
  await db.workspace.deleteMany({ where: { ownerId: owner } }); await db.$disconnect();
});

it("persists distinct pass, behavior, provider and grader outcomes without unlocking unavailable evidence", async () => {
  const agent = await createAgent(owner, { name: "Classification fixture", instructions: "Answer safely", model: "gemini", enabledTools: [] });
  const test = await createTestCase(owner, agent.id, { input: "Return policy?", mustContain: ["30 days"] });
  const run = () => runEvaluation(owner, agent.id, undefined, deps);
  expect((await run()).results[0].outcome).toBe("pass");
  await updateTestCase(owner, test.id, { mustContain: ["90 days"] });
  expect((await run()).results[0]).toMatchObject({ status: "failed", outcome: "behavior_failure" });
  await updateTestCase(owner, test.id, { mustContain: ["30 days"] });
  const unavailable = await runEvaluation(owner, agent.id, undefined, { ...deps, driver: { ...driver,
    turn: async () => { throw Object.assign(new Error("private provider body"), { status: 503 }); } } });
  expect(unavailable.results[0]).toMatchObject({ status: "error", outcome: "provider_unavailable" });
  expect(JSON.stringify(unavailable)).not.toContain("private provider body");
  expect((await latestTestReport(owner, agent.id, 1))?.results[0].outcome).toBe("provider_unavailable");
  expect((await getPublishStatus(owner, agent.id)).canPublish).toBe(false);
  await updateTestCase(owner, test.id, { useGrader: true });
  const graded = await runEvaluation(owner, agent.id, undefined, deps, async () => ({ followsPolicy: false, reason: "grader unavailable", unavailable: true }));
  expect(graded.results[0]).toMatchObject({ status: "error", outcome: "grader_unavailable" });
  expect((await latestTestReport(owner, agent.id, 1))?.results[0].outcome).toBe("grader_unavailable");
  expect((await getPublishStatus(owner, agent.id)).canPublish).toBe(false);
});
