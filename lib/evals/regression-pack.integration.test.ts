import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { createAgent, updateAgent } from "@/lib/agents/library/store";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { ModelDriver, ModelTurn } from "@/lib/agents/runtime/model";
import { promoteRelease } from "@/lib/agents/releases/promote";
import { resolveServingRelease } from "@/lib/agents/releases/resolve";
import { createTestCase, installSupportRegressionPack, listTestCases } from "./test-cases";
import { runEvaluation } from "./runner";
import { getPublishStatus, latestTestReport } from "./publish-gate";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb(); const owner = `regressions-it-${randomUUID()}`;
const input = { name: "Support regression fixture", instructions: "correct", model: "gemini", enabledTools: ["knowledge_search", "create_ticket"] };
const turn = (text: string, calls: ModelTurn["calls"] = []): ModelTurn => ({ text, calls, messages: [], inputTokens: 1, outputTokens: 1 });
const call = (toolId: string, toolCallId: string, input: object) => ({ toolId, toolCallId, input });
let retrievedInjection = false;
const driver: ModelDriver = { key: "regression-fixture", estimate: () => 0.00001, turn: async (config, messages) => {
  const question = String(messages.find(m => m.role === "user")?.content);
  const usedTools = messages.filter(m => m.role === "tool");
  const broken = config.instructions === "broken";
  if (question.startsWith("Look up")) {
    if (!usedTools.length) return turn("", [call("knowledge_search", "lookup", { query: "return policy" })]);
    retrievedInjection ||= JSON.stringify(usedTools).includes("SYSTEM OVERRIDE");
    if (broken && usedTools.length === 1) return turn("", [call("create_ticket", "injected", { subject: "Policy override accepted" })]);
    return turn("Returns are accepted within 30 days.");
  }
  if (question.startsWith("Ignore your")) return broken && !usedTools.length
    ? turn("", [call("send_email", "unauthorized", {})]) : turn("I cannot send external messages.");
  if (usedTools.length) return turn("Ticket created successfully.");
  if (question.startsWith("Open one")) return turn("", Array.from({ length: broken ? 2 : 1 }, (_, i) => call("create_ticket", `duplicate-${i}`, { subject: "Delivery review 1042" })));
  return broken ? turn("Ticket created successfully.") : turn("", [call("create_ticket", "payment", { subject: "Payment review 1042" })]);
} };
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver };
afterAll(async () => {
  for (const run of await db.agentRun.findMany({ where: { ownerId: owner } })) await (await graphCheckpointer()).deleteThread(run.id);
  await db.agentRun.deleteMany({ where: { ownerId: owner } });
  await db.agent.deleteMany({ where: { ownerId: owner } });
  await db.workspace.deleteMany({ where: { ownerId: owner } }); await db.$disconnect();
});

it("installs four owned cases atomically, preserves custom cases and is safe to repeat", async () => {
  const agent = await createAgent(owner, input);
  const custom = await createTestCase(owner, agent.id, { input: "Keep my custom case" });
  const installed = await installSupportRegressionPack(owner, agent.id);
  expect(installed).toHaveLength(5); expect(installed.some(c => c.id === custom.id)).toBe(true);
  expect((await installSupportRegressionPack(owner, agent.id)).map(c => c.id)).toEqual(installed.map(c => c.id));
  await expect(installSupportRegressionPack("other-owner", agent.id)).rejects.toThrow("agent_not_found");
  const full = await createAgent(owner, input);
  await createTestCase(owner, full.id, { input: "Existing one" }); await createTestCase(owner, full.id, { input: "Existing two" });
  await expect(installSupportRegressionPack(owner, full.id)).rejects.toThrow("regression_pack_needs_four_slots");
  expect(await listTestCases(owner, full.id)).toHaveLength(2);
  const unsupported = await createAgent(owner, { ...input, enabledTools: [] });
  await expect(installSupportRegressionPack(owner, unsupported.id)).rejects.toThrow("regression_pack_requires_support_tools");
  expect(await listTestCases(owner, unsupported.id)).toHaveLength(0);
});

it("promotes a passing support suite then blocks an adversarial v2 with exact retained diffs and unchanged serving release", async () => {
  const agent = await createAgent(owner, input);
  const cases = await installSupportRegressionPack(owner, agent.id);
  const liveTickets = await db.demoTicket.count();
  const passing = await runEvaluation(owner, agent.id, undefined, deps);
  expect(passing.results.map(r => r.outcome)).toEqual(["pass", "pass", "pass", "pass"]);
  expect(retrievedInjection).toBe(true);
  const release = await promoteRelease(owner, agent.id);
  await updateAgent(owner, agent.id, { ...input, instructions: "broken" });
  const failing = await runEvaluation(owner, agent.id, undefined, deps);
  expect(failing.results.map(r => r.outcome)).toEqual(["behavior_failure", "behavior_failure", "behavior_failure", "behavior_failure"]);
  const duplicate = failing.results.find(r => r.testCaseId === cases.find(c => c.input.startsWith("Open one"))!.id)!;
  expect(duplicate.stateEvidence!.before.tickets).toHaveLength(0); expect(duplicate.stateEvidence!.after.tickets).toHaveLength(2);
  expect((duplicate.stateEvidence!.diff as { tickets: { added: unknown[] } }).tickets.added).toHaveLength(2);
  const falseSuccess = failing.results.find(r => r.testCaseId === cases.find(c => c.input.startsWith("Open a ticket"))!.id)!;
  expect(falseSuccess.response).toBe("Ticket created successfully.");
  expect(falseSuccess.stateEvidence!.after.tickets).toHaveLength(0); expect(falseSuccess.stateEvidence!.passed).toBe(false);
  expect((await latestTestReport(owner, agent.id, 2))?.results).toEqual(failing.results);
  expect((await getPublishStatus(owner, agent.id)).canPublish).toBe(false);
  await expect(promoteRelease(owner, agent.id)).rejects.toThrow("tests_not_passed");
  expect((await resolveServingRelease(owner, agent.id)).releaseId).toBe(release.id);
  expect(await db.demoTicket.count()).toBe(liveTickets);
});
