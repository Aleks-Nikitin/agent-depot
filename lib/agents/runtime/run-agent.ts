import type { ModelMessage } from "ai";
import { isDeepStrictEqual } from "node:util";
import { AgentConfigSchema, RunRequestSchema, type AgentConfig, type AgentRunResult, type EventInput, type RunStep } from "../contracts";
import type { RunStore } from "../storage/prisma-store";
import { dispatchTool, enabledTools, permittedTool, type ToolRegistry } from "../tools/registry";
import type { ModelDriver } from "./model";
import type { Checkpoint, PendingCall } from "./state";
import { withCancellation } from "./cancellation";

export type RuntimeDependencies = {
  store: RunStore; registry: ToolRegistry; driver: ModelDriver;
  signal?: AbortSignal; onEvent?: (event: RunStep) => void | Promise<void>;
};
class PolicyBlock extends Error {}
class EventDeliveryError extends Error {}
function guard(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new PolicyBlock(reason);
}
function addResult(state: Checkpoint, call: PendingCall, output: unknown) {
  state.messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: call.toolCallId,
    toolName: call.toolId, output: { type: "json", value: JSON.parse(JSON.stringify(output)) } }] });
}
export async function runAgent(options: {
  config: AgentConfig; ownerId: string; message: string; approvalMode?: "human" | "deny";
}, deps: RuntimeDependencies): Promise<AgentRunResult> {
  const config = AgentConfigSchema.parse(options.config);
  if (config.ownerId !== options.ownerId) throw new Error("agent_not_found");
  const { message } = RunRequestSchema.parse({ message: options.message });
  enabledTools(config, deps.registry);
  const state: Checkpoint = { schemaVersion: 1, messages: [{ role: "user", content: message }], pending: [], seenCallIds: [],
    writeCalls: 0, modelCalls: 0, toolCalls: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    startedAt: Date.now(), activeMs: 0, approvalMode: options.approvalMode ?? "human", driverKey: deps.driver.key };
  const run = await deps.store.createRun(config, state);
  return continueRun(run.id, options.ownerId, deps, undefined, "run_started");
}

export async function resumeAgent(options: { approvalId: string; ownerId: string; approved: boolean }, deps: RuntimeDependencies) {
  const claim = await deps.store.claimApproval(options.approvalId, options.ownerId, options.approved);
  return resumeClaimedRun(claim, options.ownerId, options.approved, deps);
}

export async function resumeClaimedRun(claim: Awaited<ReturnType<RunStore["claimApproval"]>>, ownerId: string, approved: boolean, deps: RuntimeDependencies) {
  return continueRun(claim.approval.runId, ownerId, deps, {
    call: { toolCallId: claim.approval.toolCallId, toolId: claim.approval.toolId, input: claim.approval.input }, approved,
  }, claim.event);
}

async function continueRun(runId: string, ownerId: string, deps: RuntimeDependencies,
  decision?: { call: PendingCall; approved: boolean }, openingEvent?: RunStep | "run_started"): Promise<AgentRunResult> {
  const loaded = await deps.store.loadRun(runId, ownerId);
  if (loaded.status !== "running") throw new Error("run_unavailable");
  const { config, state } = loaded;
  let version = loaded.version;
  const invocationStarted = Date.now();
  const previousActive = state.activeMs;
  const signal = deps.signal
    ? AbortSignal.any([deps.signal, AbortSignal.timeout(Math.max(1, config.limits.timeoutMs - state.activeMs))])
    : AbortSignal.timeout(Math.max(1, config.limits.timeoutMs - state.activeMs));
  const elapsed = () => { state.activeMs = previousActive + Date.now() - invocationStarted; };
  let deliveryFailed = false;
  const deliver = async (event: RunStep) => {
    if (deliveryFailed) return;
    const callback = deps.onEvent;
    if (!callback) return;
    try { await withCancellation(signal, async () => callback(event)); }
    catch (error) {
      deliveryFailed = true;
      if (signal.aborted) throw error;
      throw new EventDeliveryError("event_delivery_failed");
    }
  };
  // Once a pause/terminal state is durable, notification failure must not try to
  // finalize that run a second time or consume a pending approval.
  const deliverSettled = async (event: RunStep) => {
    try { await deliver(event); } catch { /* Stored state/event can be replayed. */ }
  };
  const emit = async (event: EventInput) => {
    const saved = await deps.store.appendEvent(runId, ownerId, event);
    await deliver(saved);
  };
  const save = async () => { elapsed(); version = await deps.store.saveCheckpoint(runId, ownerId, version, state); };
  const finish = async (status: "completed" | "blocked" | "failed", response: string | null, reason: string | null): Promise<AgentRunResult> => {
    elapsed();
    const event = await deps.store.finishRun(runId, ownerId, version, state, status, response, reason);
    await deliverSettled(event);
    return { runId, status, response, stopReason: reason, usage: state.usage };
  };
  try {
    if (openingEvent === "run_started") await emit({ type: "run_started", payload: { agentId: config.id } });
    else if (openingEvent) await deliver(openingEvent);
    guard(state.driverKey === deps.driver.key, "model_policy_changed");
    if (decision) guard(isDeepStrictEqual(state.pending[0], decision.call), "approval_call_mismatch");
    while (true) {
      signal.throwIfAborted();
      elapsed(); guard(state.activeMs < config.limits.timeoutMs, "deadline");
      guard(state.usage.estimatedCostUsd !== null, "usage_unknown");
      guard(state.usage.estimatedCostUsd < config.limits.maxEstimatedCostUsd, "budget_limit");
      while (state.pending.length) {
        signal.throwIfAborted();
        const call = state.pending[0];
        const selected = permittedTool(config, deps.registry, call.toolId);
        guard(state.toolCalls < config.limits.maxToolCalls, "tool_limit");
        // The saved decision applies to this call only, even if its trusted
        // registry classification changed while the run was paused.
        const callDecision = decision;
        decision = undefined;
        if (callDecision?.approved === false || (selected.kind === "write" && state.approvalMode === "deny")) {
          state.toolCalls++;
          await emit({ type: "tool_failed", payload: { toolCallId: call.toolCallId, toolId: call.toolId, reason: "write_denied" } });
          addResult(state, call, { denied: true, reason: "write_denied" });
          state.pending.shift(); await save(); continue;
        }
        const normalizedInput = selected.inputSchema.parse(call.input);
        if (callDecision?.approved) guard(isDeepStrictEqual(normalizedInput, callDecision.call.input), "approval_input_changed");
        // Display and checkpoint the executable arguments, including schema
        // defaults, before asking a person to approve the operation.
        call.input = normalizedInput;
        let writeApproved = false;
        if (selected.kind === "write") {
          guard((state.writeCalls ?? 0) < config.limits.maxWriteCalls, "write_limit");
          if (!callDecision && (config.requireWriteApproval || !selected.automaticWrites || (selected.canAutoWrite ? !selected.canAutoWrite(call.input) : false))) {
            elapsed();
            const pause = await deps.store.pauseForApproval(runId, ownerId, version, state, call);
            await deliverSettled(pause.event);
            return { runId, status: "waiting_approval", response: null, stopReason: null, usage: state.usage };
          }
          writeApproved = true;
          state.writeCalls = (state.writeCalls ?? 0) + 1;
        }
        state.toolCalls++;
        await save();
        await emit({ type: "tool_started", payload: { ...call, authorization: selected.kind === "read" ? "read" : callDecision ? "human" : "policy" } });
        const started = Date.now();
        let output: unknown;
        try {
          output = await withCancellation(signal, () => dispatchTool({ config, registry: deps.registry, toolId: call.toolId, input: call.input, writeApproved,
            context: { ownerId, runId, toolCallId: call.toolCallId, idempotencyKey: `${runId}:${call.toolCallId}`, signal } }));
        } catch (error) {
          const safeCodes = new Set(["ticket_not_found", "idempotency_conflict"]);
          const reason = error instanceof Error && safeCodes.has(error.message) ? error.message : "tool_execution_failed";
          await emit({ type: "tool_failed", payload: { toolId: call.toolId, toolCallId: call.toolCallId, reason } });
          throw error;
        }
        addResult(state, call, output); state.pending.shift(); await save();
        await emit({ type: "tool_finished", payload: { toolCallId: call.toolCallId, toolId: call.toolId, output, durationMs: Date.now() - started } });
      }
      guard(state.modelCalls < config.limits.maxModelCalls, "step_limit");
      const tools = enabledTools(config, deps.registry);
      // Conservative text estimate: full UTF-8 byte size plus schema/prompt margin.
      // This is explicitly an estimate, not a provider invoice guarantee.
      const bytes = Buffer.byteLength(JSON.stringify({ instructions: config.instructions, messages: state.messages,
        tools: tools.map(t => ({ id: t.id, description: t.description, schema: t.inputSchema.toJSONSchema() })) }));
      guard(bytes <= 100_000, "context_limit");
      const reserved = deps.driver.estimate(bytes + 4096, config.limits.maxOutputTokens);
      guard(Number.isFinite(reserved) && reserved >= 0, "pricing_unknown");
      guard(state.usage.estimatedCostUsd! + reserved <= config.limits.maxEstimatedCostUsd, "budget_limit");
      const previousUsage = { ...state.usage };
      // Persist a conservative reservation before dispatch: an interrupted call
      // may still be billed and must not appear as free in saved history.
      state.usage = { inputTokens: null, outputTokens: null, estimatedCostUsd: previousUsage.estimatedCostUsd! + reserved };
      state.modelCalls++; await save();
      await emit({ type: "model_started", payload: { step: state.modelCalls } });
      const turn = await withCancellation(signal, () => deps.driver.turn(config, state.messages as ModelMessage[], tools, signal));
      signal.throwIfAborted();
      const usageKnown = turn.inputTokens !== null && turn.outputTokens !== null
        && Number.isFinite(turn.inputTokens) && Number.isFinite(turn.outputTokens)
        && turn.inputTokens >= 0 && turn.outputTokens >= 0;
      const cost = usageKnown ? deps.driver.estimate(turn.inputTokens!, turn.outputTokens!) : null;
      state.usage = {
        inputTokens: usageKnown ? previousUsage.inputTokens! + turn.inputTokens! : null,
        outputTokens: usageKnown ? previousUsage.outputTokens! + turn.outputTokens! : null,
        estimatedCostUsd: cost !== null && Number.isFinite(cost) && cost >= 0 ? previousUsage.estimatedCostUsd! + cost : null,
      };
      state.messages.push(...turn.messages);
      await save();
      await emit({ type: "model_finished", payload: { inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, estimatedCostUsd: cost } });
      guard(state.usage.estimatedCostUsd !== null, "usage_unknown");
      guard(state.usage.estimatedCostUsd <= config.limits.maxEstimatedCostUsd, "budget_limit");
      guard(turn.outputTokens! <= config.limits.maxOutputTokens, "output_limit");
      guard(turn.finishReason !== "length", "output_limit");
      guard(turn.finishReason !== "content-filter", "model_content_filtered");
      guard(turn.finishReason === undefined || turn.finishReason === "stop" || turn.finishReason === "tool-calls", "model_incomplete");
      if (turn.calls.length) {
        guard(turn.calls.length <= config.limits.maxToolCalls - state.toolCalls, "tool_limit");
        for (const call of turn.calls) {
          guard(!state.seenCallIds.includes(call.toolCallId), "duplicate_tool_call");
          state.seenCallIds.push(call.toolCallId);
          state.pending.push(call);
          await emit({ type: "tool_requested", payload: call });
        }
        await save();
      } else {
        guard(turn.text.trim().length > 0, "empty_response");
        return finish("completed", turn.text, null);
      }
    }
  } catch (error) {
    if (error instanceof EventDeliveryError) return finish("failed", null, "event_delivery_failed");
    if (error instanceof PolicyBlock) return finish("blocked", null, error.message);
    if (signal.aborted) return finish("failed", null, "interrupted_or_timeout");
    // Provider/tool exception text may contain credentials or sensitive response bodies.
    return finish("failed", null, "execution_failed");
  }
}
