import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createConversation, conversationView, sendConversationTurn, prepareConversationTurn } from "../sessions/store";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { databaseUrl, databaseConnectionSummary } from "@/lib/db/connection";
import { getRun, listRuns } from "@/lib/runs/queries";
import { z } from "zod";
import { createRegistry } from "../tools/registry";
import { resumeAgent } from "../runtime/run-agent";
import { getDb } from "@/lib/db/prisma";
import { createAgent, updateAgent, getAgent, listAgents } from "../library/store";
import { PrismaRunStore } from "../storage/prisma-store";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { ModelDriver } from "../runtime/model";
import { runEvaluation } from "@/lib/evals/runner";
import { createTestCase, updateTestCase } from "@/lib/evals/test-cases";
import { promoteRelease, rollbackRelease } from "./promote";
import { resolveServingRelease } from "./resolve";
import { executeServing } from "./execute";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb();
const saver = PostgresSaver.fromConnString(databaseUrl()!, { schema: "langgraph_checkpoints" });
beforeAll(() => saver.setup());
const ownerId = `releases-it-${randomUUID()}`;
const agents: string[] = [];
const input = { name: "Release fixture", instructions: "Approved response", model: "gemini", enabledTools: [] };
let calls = 0;
const driver: ModelDriver = { key: "releases-it", estimate: () => 0.00001, turn: async config => {
  calls++;
  return { text: config.instructions, calls: [], messages: [], inputTokens: 1, outputTokens: 1 };
} };
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver, checkpointer: async () => saver };
async function setup() {
  const agent = await createAgent(ownerId, input); agents.push(agent.id);
  const test = await createTestCase(ownerId, agent.id, { input: "Answer", mustContain: ["Approved"] });
  return { agent, test };
}
afterAll(async () => {
  const rows = await db.agentRun.findMany({ where: { ownerId }, select: { id: true, sessionId: true } });
  for (const thread of new Set(rows.map(row => row.sessionId ? `session:${row.sessionId}` : row.id))) await saver.deleteThread(thread);
  await saver.end();
  await db.testRun.deleteMany({ where: { agentId: { in: agents } } });
  await db.agentRun.deleteMany({ where: { ownerId } });
  await db.agent.deleteMany({ where: { ownerId } });
  await db.workspace.deleteMany({ where: { ownerId } });
  await db.$disconnect();
});

it("isolates serving from broken drafts, promotes atomically and deduplicates execution", async () => {
  const { agent } = await setup();
  await db.agent.update({ where: { id: agent.id }, data: { published: true, publishedVersion: 1 } });
  expect((await getAgent(ownerId, agent.id)).published).toBe(false);
  expect((await listAgents(ownerId)).find(row => row.id === agent.id)?.published).toBe(false);
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

it("pins bounded conversations across edits, preserves graph history and serializes turns", async () => {
  const { agent } = await setup();
  const session = await createConversation(ownerId, agent.id, "draft", 1);
  await expect(db.conversationSession.update({ where: { id: session.id }, data: { config: {} } })).rejects.toThrow("immutable_conversation_artifact");
  await updateAgent(ownerId, agent.id, { ...input, instructions: "New draft response" });
  let release!: () => void; let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const histories: string[] = [];
  const profiles: string[] = [];
  const pinnedDeps = { ...deps, driverForConfig: (_config: Parameters<ModelDriver["turn"]>[0], settings?: { RUNTIME_MODEL_ID: string }) => {
    profiles.push(settings!.RUNTIME_MODEL_ID);
    return { ...driver, key: `pinned:${settings!.RUNTIME_MODEL_ID}`, turn: async (...args: Parameters<ModelDriver["turn"]>) => {
      histories.push(JSON.stringify(args[1])); entered(); await wait; return driver.turn(...args);
    } };
  } };
  const first = sendConversationTurn(ownerId, agent.id, session.id, "Remember jacket", "first", pinnedDeps);
  await ready;
  try {
    await expect(sendConversationTurn(ownerId, agent.id, session.id, "Racing message", "racer", pinnedDeps)).rejects.toThrow("conversation_busy");
    await expect(sendConversationTurn("another-owner", agent.id, session.id, "Unauthorized", "first", pinnedDeps)).rejects.toThrow("conversation_not_found");
    expect((await sendConversationTurn(ownerId, agent.id, session.id, "Remember jacket", "first", pinnedDeps)).status).toBe("running");
  } finally { release(); }
  const completed = await first;
  expect(completed.response).toBe("Approved response");
  try {
    vi.stubEnv("RUNTIME_MODEL_ID", "changed-after-session-creation");
    const second = await sendConversationTurn(ownerId, agent.id, session.id, "What did I say?", "second", pinnedDeps);
    expect(second.response).toBe("Approved response");
    expect((await getRun(ownerId, second.runId))?.run.input).toBe("What did I say?");
    expect(histories[1]).toContain("Remember jacket"); expect(histories[1]).toContain("Approved response");
    expect(profiles[0]).toBe(profiles[1]);
    const tuple = await saver.getTuple({ configurable: { thread_id: `session:${session.id}` } });
    expect((tuple!.checkpoint.channel_values.messages as unknown[]).length).toBeGreaterThanOrEqual(4);
    expect((await sendConversationTurn(ownerId, agent.id, session.id, "What did I say?", "second", pinnedDeps)).runId).toBe(second.runId);
  } finally { vi.unstubAllEnvs(); }
  const view = await conversationView(ownerId, agent.id, session.id);
  expect(view).toMatchObject({ version: 1, target: "draft", turnCount: 2, activeRunId: null });
  expect(view.turns).toHaveLength(2);
  expect(JSON.stringify(view)).not.toMatch(/providerSettings|configSnapshot|checkpoint|API_KEY/);
  await db.conversationSession.update({ where: { id: session.id }, data: { turnCount: 10 } });
  await expect(prepareConversationTurn(ownerId, agent.id, session.id, "Too many")).rejects.toThrow("conversation_turn_limit");
  const expired = await createConversation(ownerId, agent.id, "draft", 1);
  await db.conversationSession.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
  await expect(prepareConversationTurn(ownerId, agent.id, expired.id, "Too late")).rejects.toThrow("conversation_expired");
  const empty = await createConversation(ownerId, agent.id, "draft", 1);
  await expect(prepareConversationTurn(ownerId, agent.id, empty.id, "x".repeat(48_001))).rejects.toThrow("conversation_context_limit");
  // A serving conversation stays on the approved artifact even after promotion/rollback elsewhere.
  await runEvaluation(ownerId, agent.id, undefined, { ...deps, driver: { ...driver, turn: async () => ({ text: "Approved", calls: [], messages: [], inputTokens: 1, outputTokens: 1 }) } });
  await promoteRelease(ownerId, agent.id);
  const serving = await createConversation(ownerId, agent.id, "release");
  await updateAgent(ownerId, agent.id, { ...input, instructions: "Another draft" });
  expect((await sendConversationTurn(ownerId, agent.id, serving.id, "Pinned release?", "serving-turn", deps)).response).toBe("New draft response");
  const servingRun = await db.agentRun.findFirstOrThrow({ where: { sessionId: serving.id } });
  expect(servingRun.source).toBe("serving");
  expect((await listRuns(ownerId)).runs.map(run => run.id)).toContain(servingRun.id);
  const reviewed = await createAgent(ownerId, { ...input, enabledTools: ["reviewed_write"] }); agents.push(reviewed.id);
  const reviewedSession = await createConversation(ownerId, reviewed.id, "draft");
  const events: import("../contracts").RunStep[] = [];
  let writes = 0;
  const reviewedDeps = { ...deps, registry: createRegistry([{ id: "reviewed_write", description: "Reviewed fixture", kind: "write", inputSchema: z.object({}), run: async () => { writes++; return { created: true }; } }]),
    onEvent: (event: import("../contracts").RunStep) => { events.push(event); },
    driver: { ...driver, turn: async (_config: Parameters<ModelDriver["turn"]>[0], messages: Parameters<ModelDriver["turn"]>[1]) => messages.some(message => message.role === "tool")
      ? { text: "Created", calls: [], messages: [], inputTokens: 1, outputTokens: 1 }
      : { text: "", calls: [{ toolCallId: "review-1", toolId: "reviewed_write", input: {} }], messages: [], inputTokens: 1, outputTokens: 1 } } };
  const paused = await sendConversationTurn(ownerId, reviewed.id, reviewedSession.id, "Create", "review", reviewedDeps);
  expect(paused.status).toBe("waiting_approval"); expect(writes).toBe(0);
  await expect(sendConversationTurn(ownerId, reviewed.id, reviewedSession.id, "Another", "while-waiting", reviewedDeps)).rejects.toThrow("conversation_busy");
  const approval = events.find(event => event.type === "approval_required")!;
  if (approval.type !== "approval_required") throw new Error("missing_approval");
  expect((await resumeAgent({ ownerId, approvalId: approval.payload.approvalId, approved: true }, reviewedDeps)).status).toBe("completed");
  expect(writes).toBe(1);
  expect((await conversationView(ownerId, reviewed.id, reviewedSession.id)).activeRunId).toBeNull();
});
