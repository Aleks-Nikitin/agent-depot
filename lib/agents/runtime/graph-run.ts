import { isIsolatedRepository } from "../domain/repository";
import { liveDomainRepository } from "../domain/prisma-repository";
import { approvalHash } from "./approval-hash";
import { modelWithRecovery } from "./model-recovery";
import { PolicyBlock, ExecutionFailure, guard } from "./errors";
import { toolFailureReason } from "./failures";
import type { ModelMessage } from "ai";
import { isDeepStrictEqual } from "node:util";
import { type AgentRunResult, type EventInput, type RunStep } from "../contracts";
import { dispatchTool, availableTools, permittedTool } from "../tools/registry";
import type { Checkpoint, PendingCall } from "./state";
import { withCancellation } from "./cancellation";

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { createAgent, createMiddleware, MiddlewareError, ToolInvocationError, tool } from "langchain";
import { Command, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { withoutPayloadTracing, traceRunMetadata } from "./tracing";
import { assertWorkspaceConfig, WORKSPACE_BLOCKS } from "@/lib/workspaces/policy";
import { nativeModelTurn } from "./provider-model";
import type { RuntimeDependencies } from "./run-agent";

// Injected single-turn drivers are used by offline tests and compatibility callers.
// This placeholder can never generate a simulated or billable response.
class MiddlewareModel extends BaseChatModel {
  _llmType() { return "application-single-turn-driver"; }
  async _generate(): Promise<ChatResult> { throw new Error("model_middleware_required"); }
  bindTools() { return this; }
}
class EventDeliveryError extends Error {}
function addResult(state: Checkpoint, call: PendingCall, output: unknown) {
  state.messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: call.toolCallId,
    toolName: call.toolId, output: { type: "json", value: JSON.parse(JSON.stringify(output)) } }] });
}
export async function executeGraph(runId: string, ownerId: string, deps: RuntimeDependencies,
  decision?: { call: PendingCall; approved: boolean; inputHash?: string | null }, openingEvent?: RunStep | "run_started"): Promise<AgentRunResult> {
  const loaded = await deps.store.loadRun(runId, ownerId);
  if (loaded.status !== "running") throw new Error("run_unavailable");
  const { config, state } = loaded;
  deps = { ...deps, domain: deps.domain ?? liveDomainRepository(ownerId) };
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
    const result = { runId, status, response, stopReason: reason, usage: state.usage };
    await traceRunMetadata(result, invocationStarted);
    return result;
  };
  state.toolResults ??= {};
  let finalText = "";
  // LangGraph can reject on abort before application middleware finishes its
  // durable settlement. Drain our wrappers before writing terminal state.
  const inFlight = new Set<Promise<unknown>>();
  function track<T>(operation: () => Promise<T>): Promise<T> {
    const task = operation();
    inFlight.add(task);
    void task.then(() => inFlight.delete(task), () => inFlight.delete(task));
    return task;
  }
  async function drain() {
    while (inFlight.size) await Promise.allSettled([...inFlight]);
  }
  try {
    await assertWorkspaceConfig(config);
    if (openingEvent === "run_started") await emit({ type: "run_started", payload: { agentId: config.id } });
    else if (openingEvent) await deliver(openingEvent);
    guard(deps.domain?.scope.ownerId === ownerId, "domain_owner_mismatch");
    if (state.domainScope?.kind === "evaluation") {
      guard(isIsolatedRepository(deps.domain) && deps.domain?.scope.kind === "evaluation"
        && deps.domain.scope.attemptId === state.domainScope.attemptId
        && deps.domain.scope.knowledgeHash === state.domainScope.knowledgeHash, "evaluation_scope_unavailable");
    } else guard(deps.domain?.scope.kind === "live", "domain_scope_mismatch");
    if (deps.driverForConfig && openingEvent !== "run_started") deps = { ...deps, driver: deps.driverForConfig(config, state.providerSettings) };
    guard(state.driverKey === deps.driver.key, "model_policy_changed");
    if (decision) guard(isDeepStrictEqual(state.pending[0], decision.call), "approval_call_mismatch");
    const checkpointer = await deps.checkpointer!();
    const graphConfig = { configurable: { thread_id: state.sessionId ? `session:${state.sessionId}` : runId }, signal, recursionLimit: 4 * (config.limits.maxModelCalls + config.limits.maxToolCalls) + 10 };
    // Serialize framework tool callbacks to preserve application event/CAS ordering.
    let queue: Promise<unknown> = Promise.resolve();
    let stopped: unknown;
    const middleware = createMiddleware({
      name: "application-policy-v1",
      wrapModelCall: (request, handler) => track(async () => {
        signal.throwIfAborted(); elapsed();
        guard(state.activeMs < config.limits.timeoutMs, "deadline");
        const tools = await availableTools(config, deps.registry, deps.domain);
        // Conservative text estimate: full UTF-8 byte size plus schema/prompt margin.
        // This is explicitly an estimate, not a provider invoice guarantee.
        const bytes = Buffer.byteLength(JSON.stringify({ instructions: config.instructions, messages: state.messages,
          tools: tools.map(t => ({ id: t.id, description: t.description, schema: t.inputSchema.toJSONSchema() })) }));
        guard(bytes <= 100_000, "context_limit");
        const { turn, nativeResponse } = await modelWithRecovery({
          config, state, driver: deps.driver, bytes, signal, emit,
          beforeAttempt: () => { elapsed(); guard(state.activeMs < config.limits.timeoutMs, "deadline"); },
          reserve: async attempt => { elapsed(); version = await deps.store.reserveModelAttempt(runId, ownerId, version, state, attempt); },
          settle: async (attempt, result) => { elapsed(); version = await deps.store.settleModelAttempt(runId, ownerId, version, state, attempt, result); },
          invoke: async active => {
            if (!active.chatModel) return { turn: await active.turn(config, state.messages as ModelMessage[], tools, signal) };
            const nativeResponse = await handler({ ...request, model: active.chatModel, tools: request.tools.filter(t => tools.some(allowed => allowed.id === t.name)) });
            return { turn: nativeModelTurn(nativeResponse), nativeResponse };
          },
        });
        state.messages.push(...turn.messages);
        await save();
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
          finalText = turn.text;
        }

        return nativeResponse ?? new AIMessage({ content: turn.text, tool_calls: turn.calls.map(c => ({ id: c.toolCallId, name: c.toolId, args: c.input as Record<string, unknown>, type: "tool_call" as const })) });

      }),
      wrapToolCall: (request) => track(async () => {
        signal.throwIfAborted();
        const id = request.toolCall.id!;
        if (Object.hasOwn(state.toolResults!, id)) return new ToolMessage({ tool_call_id: id, content: JSON.stringify(state.toolResults![id]) });
        const current = state.pending.find(call => call.toolCallId === id);
        guard(!!current, "approval_call_mismatch");
        await assertWorkspaceConfig(config);
        const selected = permittedTool(config, deps.registry, current.toolId);
        const denied = selected.kind === "write" && (state.approvalMode === "deny" || (state.domainScope?.kind === "evaluation" && !selected.domainScoped));
        if (selected.retired && !denied) throw new ExecutionFailure("email_removed");
        const matchingDecision = decision?.call.toolCallId === id ? decision : undefined;
        if (!denied) {
          const input = selected.inputSchema.safeParse(current.input);
          if (!input.success) throw new ExecutionFailure("invalid_tool_input");
          if (matchingDecision?.approved) guard(isDeepStrictEqual(input.data, matchingDecision.call.input), "approval_input_changed");
          current.input = input.data;
        }
        const needsReview = !denied && (matchingDecision || (selected.kind === "write" &&
          ((config.requireWriteApproval && !selected.approvalExempt) || !selected.automaticWrites || (selected.canAutoWrite ? !selected.canAutoWrite(current.input) : false))));
        if (needsReview) {
          // Each v2 tool task owns its interrupt ID. A resume targets only that task.
          const callHash = approvalHash(ownerId, runId, current);
          const reply = interrupt<PendingCall & { callHash: string }, { approved: boolean; callHash: string }>({ ...current, callHash });
          guard(!!matchingDecision && reply.approved === matchingDecision.approved && reply.callHash === callHash
            && matchingDecision.inputHash === callHash && isDeepStrictEqual(current, matchingDecision.call), "approval_call_mismatch");
        }
        const execute = async () => {
          signal.throwIfAborted();
          if (stopped) throw stopped;
          const output = await executeTool(current);
          return new ToolMessage({ tool_call_id: id, content: JSON.stringify(output) });
        };
        const next = queue.then(execute);
        queue = next.catch(error => { stopped = error; });
        return next;
      }),
    });
    async function executeTool(call: PendingCall) {
      const selected = permittedTool(config, deps.registry, call.toolId);
      guard(state.toolCalls < config.limits.maxToolCalls, "tool_limit");
      // The saved decision applies to this call only, even if its trusted
      // registry classification changed while the run was paused.
      const callDecision = decision?.call.toolCallId === call.toolCallId ? decision : undefined;
      if (callDecision) decision = undefined;
      if (callDecision?.approved === false || (selected.kind === "write" && (state.approvalMode === "deny" || (state.domainScope?.kind === "evaluation" && !selected.domainScoped)))) {
        state.toolCalls++;
        await emit({ type: "tool_failed", payload: { toolCallId: call.toolCallId, toolId: call.toolId, reason: "write_denied" } });
        addResult(state, call, { denied: true, reason: "write_denied" });
        state.pending = state.pending.filter(pending => pending.toolCallId !== call.toolCallId); state.toolResults![call.toolCallId] = { denied: true, reason: "write_denied" }; await save(); return { denied: true, reason: "write_denied" };
      }
      if (selected.retired) throw new ExecutionFailure("email_removed");
      if (selected.unavailable?.()) throw new ExecutionFailure(selected.unavailable()!);
      const parsedInput = selected.inputSchema.safeParse(call.input);
      if (!parsedInput.success) throw new ExecutionFailure("invalid_tool_input");
      const normalizedInput = parsedInput.data;
      if (callDecision?.approved) guard(isDeepStrictEqual(normalizedInput, callDecision.call.input), "approval_input_changed");
      // Display and checkpoint the executable arguments, including schema
      // defaults, before asking a person to approve the operation.
      call.input = normalizedInput;
      let writeApproved = false;
      if (selected.kind === "write") {
        guard((state.writeCalls ?? 0) < config.limits.maxWriteCalls, "write_limit");
        if (!callDecision && ((config.requireWriteApproval && !selected.approvalExempt) || !selected.automaticWrites || (selected.canAutoWrite ? !selected.canAutoWrite(call.input) : false))) {
          throw new PolicyBlock("approval_required");
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
          context: { domain: deps.domain, ownerId, runId, toolCallId: call.toolCallId, idempotencyKey: `${runId}:${call.toolCallId}`, signal } }));
      } catch (error) {
        const reason = toolFailureReason(error);
        await emit({ type: "tool_failed", payload: { toolId: call.toolId, toolCallId: call.toolCallId, reason } });
        throw new ExecutionFailure(reason);
      }
      addResult(state, call, output); state.pending = state.pending.filter(pending => pending.toolCallId !== call.toolCallId); state.toolResults![call.toolCallId] = output; await save();
      await emit({ type: "tool_finished", payload: { toolCallId: call.toolCallId, toolId: call.toolId, output, durationMs: Date.now() - started } });

      return output;

    }
    const tools = (await availableTools(config, deps.registry, deps.domain)).map(t =>
      tool(async () => { throw new Error("unguarded_tool_execution"); }, { name: t.id, description: t.description, schema: t.inputSchema as z.ZodObject }));
    const agent = createAgent({
      model: deps.driver.chatModel ?? new MiddlewareModel({}),
      systemPrompt: config.instructions + "\nOnly claim actions supported by successful tool results. Unavailable tools cannot execute.", tools, middleware: [middleware], checkpointer,
    });
    const result = await withoutPayloadTracing(() => agent.invoke(decision ? new Command({ resume: state.approvalInterruptId
      ? { [state.approvalInterruptId]: { approved: decision.approved, callHash: decision.inputHash } }
      : { approved: decision.approved, callHash: decision.inputHash } }) : { messages: [{ role: "user", content: String(state.messages[state.messages.length - 1].content) }] }, graphConfig));
    if (result.__interrupt__?.length) {
      const call = state.pending[0];
      guard(!!call, "approval_call_mismatch");
      const callHash = approvalHash(ownerId, runId, call);
      const pendingInterrupt = result.__interrupt__.find(item => (item.value as { callHash?: string }).callHash === callHash);
      guard(!!pendingInterrupt?.id, "approval_call_mismatch");
      state.approvalInterruptId = pendingInterrupt.id;
      elapsed();
      const pause = await deps.store.pauseForApproval(runId, ownerId, version, state, call);
      await deliverSettled(pause.event);
      return { runId, status: "waiting_approval", response: null, stopReason: null, usage: state.usage };
    }
    return finish("completed", finalText, null);
  } catch (caught) {
    await drain();
    let error: unknown = caught;
    for (let i = 0; i < 8; i++) {
      if (MiddlewareError.isInstance(error) && error.cause) error = error.cause;
      else if (ToolInvocationError.isInstance(error)) error = error.toolError;
      else break;
    }
    if (error instanceof EventDeliveryError) return finish("failed", null, "event_delivery_failed");
    if (error instanceof Error && WORKSPACE_BLOCKS.has(error.message)) return finish("blocked", null, error.message);
    if (error instanceof PolicyBlock) return finish("blocked", null, error.message);
    if (signal.aborted) return finish("failed", null, "interrupted_or_timeout");
    if (error instanceof ExecutionFailure) return finish("failed", null, error.message);
    // Provider/tool exception text may contain credentials or sensitive response bodies.
    return finish("failed", null, "execution_failed");
  }
}
