import "dotenv/config";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { getDb } from "../../db/prisma";
import { supportAgent, salesAgent } from "../fixtures";
import { PrismaRunStore } from "../storage/prisma-store";
import { createRegistry } from "../tools/registry";
import { runAgent, resumeAgent } from "./run-agent";
import type { ModelDriver, ModelTurn } from "./model";
import type { PendingCall } from "./state";
import type { AgentConfig, RunStep } from "../contracts";

const db = getDb();
const store = new PrismaRunStore(db);
const created: string[] = [];
afterAll(async () => {
  await db.agentRun.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});
function answer(text = "Fixture answer"): ModelTurn {
  return { text, calls: [], messages: [{ role: "assistant", content: text }], inputTokens: 10, outputTokens: 5 };
}
function request(...calls: PendingCall[]): ModelTurn {
  return { ...answer(""), calls, messages: [{ role: "assistant", content: calls.map(c => ({
    type: "tool-call", toolCallId: c.toolCallId, toolName: c.toolId, input: c.input,
  })) }] };
}
function driver(turns: ModelTurn[]): ModelDriver {
  return { key: "test", estimate: (i, o) => (i + o) / 1_000_000,
    turn: vi.fn(async () => {
      const next = turns.shift(); if (!next) throw new Error("no_scripted_turn"); return next;
    }) };
}
function registry() {
  const run = vi.fn(async () => ({ text: "fixture data" }));
  return { run, tools: createRegistry(["knowledge_search", "sales_lookup", "create_ticket"].map(id => ({
    id, kind: id === "create_ticket" ? "write" as const : "read" as const,
    description: id, inputSchema: z.object({ query: z.string() }), run,
  }))) };
}
async function execute(config: AgentConfig, model: ModelDriver, mode: "human" | "deny" = "human") {
  const events: RunStep[] = [];
  const tools = registry();
  const result = await runAgent({ config, ownerId: "demo", message: "test", approvalMode: mode }, {
    store, driver: model, registry: tools.tools, onEvent(event) { events.push(event); if (event.type === "run_started") created.push(event.runId); },
  });
  return { result, events, tools };
}
it("runs two configurations with distinct tools and persists ordered observable events", async () => {
  for (const [config, toolId] of [[supportAgent, "knowledge_search"], [salesAgent, "sales_lookup"]] as const) {
    const model = driver([request({ toolId, toolCallId: "call-1", input: { query: "test" } }), answer()]);
    const { result, events, tools } = await execute(config, model);
    expect(result.status).toBe("completed");
    expect(tools.run).toHaveBeenCalledOnce();
    expect(events.map(e => e.sequence)).toEqual(events.map((_, i) => i + 1));
    expect((await store.history(result.runId, "demo")).events).toEqual(events);
    expect(events.findIndex(e => e.type === "tool_started")).toBeLessThan(events.findIndex(e => e.type === "tool_finished"));
    expect(model.turn).toHaveBeenCalledTimes(2);
  }
});
it("disabled tools and malformed arguments never execute", async () => {
  for (const call of [
    { toolId: "sales_lookup", toolCallId: "bad", input: { query: "test" } },
    { toolId: "knowledge_search", toolCallId: "bad", input: {} },
  ]) {
    const { result, tools } = await execute(supportAgent, driver([request(call)]));
    expect(result.status).toBe("failed"); expect(tools.run).not.toHaveBeenCalled();
  }
});
it("enforces model and budget limits without further provider calls", async () => {
  const model = driver([request({ toolId: "knowledge_search", toolCallId: "c", input: { query: "test" } }), answer()]);
  const limited = await execute({ ...supportAgent, limits: { ...supportAgent.limits, maxModelCalls: 1 } }, model);
  expect(limited.result.stopReason).toBe("step_limit"); expect(model.turn).toHaveBeenCalledOnce();
  const expensive = driver([answer()]);
  const blocked = await execute({ ...supportAgent, limits: { ...supportAgent.limits, maxEstimatedCostUsd: 0.000001 } }, expensive);
  expect(blocked.result.stopReason).toBe("budget_limit"); expect(expensive.turn).not.toHaveBeenCalled();
});
it("stops on unknown usage before tools execute", async () => {
  const model = driver([{ ...request({ toolId: "knowledge_search", toolCallId: "c", input: { query: "test" } }), inputTokens: null }]);
  const { result, tools } = await execute(supportAgent, model);
  expect(result.stopReason).toBe("usage_unknown"); expect(tools.run).not.toHaveBeenCalled();
  expect(result.usage.estimatedCostUsd).toBeNull();
});
it("evaluations deny writes and continue without opening approval waits", async () => {
  const { result, events, tools } = await execute(supportAgent, driver([
    request({ toolId: "create_ticket", toolCallId: "write", input: { query: "test" } }), answer("Denied."),
  ]), "deny");
  expect(result.status).toBe("completed"); expect(tools.run).not.toHaveBeenCalled();
  expect(events.some(e => e.type === "approval_required")).toBe(false);
});

it("pauses before writes and resumes a stored call only once after approval", async () => {
  const model = driver([request({ toolId: "create_ticket", toolCallId: "write", input: { query: "original" } }), answer("Ticket created.")]);
  const { result, events, tools } = await execute(supportAgent, model);
  expect(result.status).toBe("waiting_approval"); expect(tools.run).not.toHaveBeenCalled();
  const event = events.find(e => e.type === "approval_required");
  if (!event || event.type !== "approval_required") throw new Error("missing approval");
  const deps = { store: new PrismaRunStore(db), driver: model, registry: tools.tools };
  const resumed = await resumeAgent({ approvalId: event.payload.approvalId, ownerId: "demo", approved: true }, deps);
  expect(resumed.status).toBe("completed"); expect(resumed.runId).toBe(result.runId);
  expect(tools.run).toHaveBeenCalledOnce(); expect(tools.run).toHaveBeenCalledWith({ query: "original" }, expect.anything());
  await expect(resumeAgent({ approvalId: event.payload.approvalId, ownerId: "demo", approved: true }, deps)).rejects.toThrow("approval_unavailable");
  expect((await store.loadRun(result.runId, "demo")).state.modelCalls).toBe(2);
});
it("human rejection prevents side effects and preserves model limits across resume", async () => {
  const model = driver([request({ toolId: "create_ticket", toolCallId: "write", input: { query: "test" } }), answer()]);
  const { result, events, tools } = await execute({ ...supportAgent, limits: { ...supportAgent.limits, maxModelCalls: 1 } }, model);
  const event = events.find(e => e.type === "approval_required");
  if (!event || event.type !== "approval_required") throw new Error("missing approval");
  const resumed = await resumeAgent({ approvalId: event.payload.approvalId, ownerId: "demo", approved: false }, {
    store, driver: model, registry: tools.tools,
  });
  expect(resumed.runId).toBe(result.runId); expect(resumed.stopReason).toBe("step_limit");
  expect(tools.run).not.toHaveBeenCalled(); expect(model.turn).toHaveBeenCalledOnce();
});
