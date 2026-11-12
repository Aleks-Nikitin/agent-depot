import type { AIMessage } from "@langchain/core/messages";
import type { AgentConfig, EventInput } from "../contracts";
import type { AttemptReservation, AttemptSettlement } from "../storage/prisma-store";
import type { Checkpoint } from "./state";
import type { ModelDriver, ModelTurn } from "./model";
import { modelFailureReason } from "./failures";
import { ExecutionFailure, guard } from "./errors";
import { withCancellation } from "./cancellation";

const transientReasons = new Set(["model_rate_limited", "model_unavailable", "model_connection_failed"]);
const plus = (a: number | null, b: number) => a === null ? null : a + b;
export async function modelWithRecovery(options: {
  config: AgentConfig; state: Checkpoint; driver: ModelDriver; bytes: number; signal: AbortSignal;
  beforeAttempt: () => void;
  reserve: (attempt: AttemptReservation) => Promise<void>;
  settle: (attempt: number, result: AttemptSettlement) => Promise<void>;
  emit: (event: EventInput) => Promise<void>;
  invoke: (driver: ModelDriver) => Promise<{ turn: ModelTurn; nativeResponse?: AIMessage }>;
}) {
  const { state, config, signal, driver, emit } = options;
  const fallback = driver.recovery?.fallback;
  let active = fallback && state.activeDriverKey === fallback.key ? fallback : driver;
  guard(!state.activeDriverKey || state.activeDriverKey === active.key, "model_policy_changed");
  state.modelSteps = (state.modelSteps ?? state.modelCalls) + 1;
  let retries = 0;
  while (true) {
    signal.throwIfAborted(); options.beforeAttempt();
    guard(state.modelCalls < config.limits.maxModelCalls, "step_limit");
    const spent = state.budgetSpentUsd ?? state.usage.estimatedCostUsd;
    guard(spent !== null, "usage_unknown");
    guard(!active.contextTokens || options.bytes + 4096 + config.limits.maxOutputTokens <= active.contextTokens, "routing_context_limit");
    const reserved = active.estimate(options.bytes + 4096, config.limits.maxOutputTokens);
    guard(Number.isFinite(reserved) && reserved >= 0, "pricing_unknown");
    guard(spent + reserved <= config.limits.maxEstimatedCostUsd, "budget_limit");
    const previous = { ...state.usage };
    state.budgetSpentUsd = spent + reserved;
    state.usage = { inputTokens: null, outputTokens: null, estimatedCostUsd: null };
    state.activeDriverKey = active.key;
    const attempt = ++state.modelCalls;
    const identity = active.identity ?? { profile: active.key, provider: "custom", model: active.key };
    state.activeModel = identity.model; state.activeProfile = identity.profile;
    await options.reserve({ attempt, modelStep: state.modelSteps, ...identity, reservedCostUsd: reserved });
    const started = Date.now();
    let invoked = false;
    let response: Awaited<ReturnType<typeof options.invoke>>;
    try {
      await emit({ type: "model_started", payload: { step: attempt, ...identity, ...(driver.routing ? { routing: driver.routing } : {}) } });
      signal.throwIfAborted();
      invoked = true;
      response = await withCancellation(signal, () => options.invoke(active));
      signal.throwIfAborted();
    } catch (error) {
      if (!invoked) {
        // Cancellation/delivery failed before the provider request: this cost is known to be zero.
        state.budgetSpentUsd = spent; state.usage = previous;
        await options.settle(attempt, { status: "failed", inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0,
          reason: "attempt_not_started", durationMs: Date.now() - started });
        throw error;
      }
      const reason = signal.aborted ? "interrupted_or_timeout" : modelFailureReason(error);
      await options.settle(attempt, { status: "failed", inputTokens: null, outputTokens: null,
        estimatedCostUsd: null, reason, durationMs: Date.now() - started });
      await emit({ type: "model_finished", payload: { inputTokens: null, outputTokens: null,
        estimatedCostUsd: null, failed: true, reason } });
      if (signal.aborted || !transientReasons.has(reason)) throw new ExecutionFailure(reason);
      let action: "retrying" | "using_fallback";
      if (retries < (driver.recovery?.maxRetries ?? 0)) {
        retries++; action = "retrying";
        // Short cancellation-aware backoff; every retry still needs a fresh reservation.
        await withCancellation(signal, () => new Promise<void>(resolve => setTimeout(resolve, 100 * retries)));
      } else if (fallback && active !== fallback) {
        active = fallback; retries = 0; action = "using_fallback";
      } else throw new ExecutionFailure(reason);
      const nextIdentity = active.identity ?? { profile: active.key, provider: "custom", model: active.key };
      await emit({ type: "model_recovery", payload: { action, reason, ...nextIdentity } });
      continue;
    }
    const { turn } = response;
    const known = turn.inputTokens !== null && turn.outputTokens !== null
      && Number.isFinite(turn.inputTokens) && Number.isFinite(turn.outputTokens)
      && turn.inputTokens >= 0 && turn.outputTokens >= 0;
    const estimated = known ? active.estimate(turn.inputTokens!, turn.outputTokens!) : null;
    const cost = estimated !== null && Number.isFinite(estimated) && estimated >= 0 ? estimated : null;
    state.budgetSpentUsd = spent + (cost ?? reserved);
    state.usage = {
      inputTokens: known ? plus(previous.inputTokens, turn.inputTokens!) : null,
      outputTokens: known ? plus(previous.outputTokens, turn.outputTokens!) : null,
      estimatedCostUsd: cost !== null ? plus(previous.estimatedCostUsd, cost) : null,
    };
    await options.settle(attempt, { status: cost === null ? "usage_unknown" : "succeeded",
      inputTokens: known ? turn.inputTokens : null, outputTokens: known ? turn.outputTokens : null,
      estimatedCostUsd: cost, reason: cost === null ? "usage_unknown" : null, durationMs: Date.now() - started });
    await emit({ type: "model_finished", payload: { inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, estimatedCostUsd: cost } });
    guard(cost !== null, "usage_unknown");
    guard(state.budgetSpentUsd <= config.limits.maxEstimatedCostUsd, "budget_limit");
    return response;
  }
}
