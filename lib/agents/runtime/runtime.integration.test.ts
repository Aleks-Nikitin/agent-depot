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

it("records a conservative reservation when a provider hangs or fails", async () => {
  for (const hanging of [false, true]) {
    const model: ModelDriver = { key: "test", estimate: (i, o) => (i + o) / 1_000_000,
      turn: vi.fn(async () => { if (hanging) return new Promise<ModelTurn>(() => {}); throw new Error("provider-secret-must-not-leak"); }) };
    const { result, events } = await execute({ ...supportAgent, limits: { ...supportAgent.limits, timeoutMs: 250 } }, model);
    expect(result.status).toBe("failed");
    expect(result.usage.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.usage.inputTokens).toBeNull();
    expect(JSON.stringify(events)).not.toContain("provider-secret");
  }
});
it("stops after reported usage exhausts the budget and before any tool executes", async () => {
  const model = driver([{ ...request({ toolId: "knowledge_search", toolCallId: "cost", input: { query: "test" } }), inputTokens: 100_000 }]);
  const { result, tools } = await execute(supportAgent, model);
  expect(result.stopReason).toBe("budget_limit");
  expect(model.turn).toHaveBeenCalledOnce(); expect(tools.run).not.toHaveBeenCalled();
});
it("does not dispatch a model request when saving its checkpoint fails", async () => {
  const failing = new PrismaRunStore(db);
  vi.spyOn(failing, "saveCheckpoint").mockRejectedValueOnce(new Error("storage failure"));
  const model = driver([answer()]);
  const result = await runAgent({ config: supportAgent, ownerId: "demo", message: "test" }, {
    store: failing, registry: registry().tools, driver: model,
    onEvent(e) { if (e.type === "run_started") created.push(e.runId); },
  });
  expect(result.status).toBe("failed"); expect(model.turn).not.toHaveBeenCalled();
});

it("does not report truncated model output as a completed answer", async () => {
  const { result } = await execute(supportAgent, driver([{ ...answer("Incomplete answer"), finishReason: "length" }]));
  expect(result.status).toBe("blocked"); expect(result.stopReason).toBe("output_limit"); expect(result.response).toBeNull();
});
it("requires a fresh approval for each distinct write in the same model turn", async () => {
  const model = driver([request(
    { toolId: "create_ticket", toolCallId: "first", input: { query: "first" } },
    { toolId: "create_ticket", toolCallId: "second", input: { query: "second" } },
  ), answer()]);
  const initial = await execute(supportAgent, model);
  const first = initial.events.find(e => e.type === "approval_required");
  if (!first || first.type !== "approval_required") throw new Error("expected first approval");
  const more: RunStep[] = [];
  const deps = { store, driver: model, registry: initial.tools.tools, onEvent(e: RunStep) { more.push(e); } };
  const pausedAgain = await resumeAgent({ approvalId: first.payload.approvalId, ownerId: "demo", approved: true }, deps);
  expect(pausedAgain.status).toBe("waiting_approval"); expect(initial.tools.run).toHaveBeenCalledOnce();
  const second = more.find(e => e.type === "approval_required");
  if (!second || second.type !== "approval_required") throw new Error("expected second approval");
  expect(second.payload.approvalId).not.toBe(first.payload.approvalId);
  const finished = await resumeAgent({ approvalId: second.payload.approvalId, ownerId: "demo", approved: false }, deps);
  expect(finished.status).toBe("completed"); expect(initial.tools.run).toHaveBeenCalledOnce();
});

it("persists a complete read-tool trace without a live event listener", async () => {
  const tools = registry();
  const result = await runAgent({ config: supportAgent, ownerId: "demo", message: "test" }, {
    store, registry: tools.tools, driver: driver([
      request({ toolId: "knowledge_search", toolCallId: "no-listener", input: { query: "test" } }), answer(),
    ]),
  });
  created.push(result.runId);
  const history = await store.history(result.runId, "demo");
  expect(history.events.map(e => e.type)).toEqual([
    "run_started", "model_started", "model_finished", "tool_requested", "tool_started", "tool_finished",
    "model_started", "model_finished", "run_completed",
  ]);
});
it("persists denied write events for evaluation runs without a live listener", async () => {
  const tools = registry();
  const result = await runAgent({ config: supportAgent, ownerId: "demo", message: "test", approvalMode: "deny" }, {
    store, registry: tools.tools, driver: driver([
      request({ toolId: "create_ticket", toolCallId: "eval-denied", input: { query: "test" } }), answer(),
    ]),
  });
  created.push(result.runId);
  const history = await store.history(result.runId, "demo");
  expect(history.events.some(e => e.type === "tool_failed" && e.payload.reason === "write_denied")).toBe(true);
  expect(tools.run).not.toHaveBeenCalled();
});

it("fails a newly started run durably if its live subscriber throws", async () => {
  const model = driver([answer()]);
  const result = await runAgent({ config: supportAgent, ownerId: "demo", message: "test" }, {
    store, registry: registry().tools, driver: model,
    onEvent(event) { created.push(event.runId); throw new Error("subscriber private details"); },
  });
  expect(result.status).toBe("failed"); expect(result.stopReason).toBe("event_delivery_failed");
  expect(model.turn).not.toHaveBeenCalled();
  const history = await store.history(result.runId, "demo");
  expect(history.events.map(e => e.type)).toEqual(["run_started", "run_failed"]);
  expect(JSON.stringify(history)).not.toContain("subscriber private details");
});
it("preserves a durable completion when only final-event delivery fails", async () => {
  const result = await runAgent({ config: supportAgent, ownerId: "demo", message: "test" }, {
    store, registry: registry().tools, driver: driver([answer()]),
    onEvent(event) { if (event.type === "run_started") created.push(event.runId); if (event.type === "run_completed") throw new Error("closed subscriber"); },
  });
  expect(result.status).toBe("completed");
  const history = await store.history(result.runId, "demo");
  expect(history.status).toBe("completed");
  expect(history.events.filter(e => ["run_completed", "run_failed"].includes(e.type))).toHaveLength(1);
});
it("preserves a pending approval when pause notification fails and permits later resume", async () => {
  const model = driver([request({ toolId: "create_ticket", toolCallId: "delivery-pause", input: { query: "test" } }), answer()]);
  const tools = registry();
  const result = await runAgent({ config: supportAgent, ownerId: "demo", message: "test" }, {
    store, driver: model, registry: tools.tools,
    onEvent(event) { if (event.type === "run_started") created.push(event.runId); if (event.type === "approval_required") throw new Error("closed subscriber"); },
  });
  expect(result.status).toBe("waiting_approval"); expect(tools.run).not.toHaveBeenCalled();
  const history = await store.history(result.runId, "demo");
  const approval = history.events.at(-1)!;
  if (approval.type !== "approval_required") throw new Error("expected durable approval");
  const resumed = await resumeAgent({ approvalId: approval.payload.approvalId, ownerId: "demo", approved: true }, { store, driver: model, registry: tools.tools });
  expect(resumed.status).toBe("completed"); expect(tools.run).toHaveBeenCalledOnce();
  const completeHistory = await store.history(result.runId, "demo");
  expect(completeHistory.events.some(e => e.type === "tool_finished")).toBe(true);
});
it("records a failure before writes if an approval-resolution subscriber fails", async () => {
  const model = driver([request({ toolId: "create_ticket", toolCallId: "resume-delivery", input: { query: "test" } }), answer()]);
  const initial = await execute(supportAgent, model);
  const approval = initial.events.find(e => e.type === "approval_required");
  if (!approval || approval.type !== "approval_required") throw new Error("expected approval");
  const result = await resumeAgent({ approvalId: approval.payload.approvalId, ownerId: "demo", approved: true }, {
    store, driver: model, registry: initial.tools.tools, onEvent() { throw new Error("closed subscriber"); },
  });
  expect(result.stopReason).toBe("event_delivery_failed"); expect(initial.tools.run).not.toHaveBeenCalled();
  expect((await store.history(result.runId, "demo")).status).toBe("failed");
});
