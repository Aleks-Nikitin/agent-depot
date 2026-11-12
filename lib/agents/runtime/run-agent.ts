import { isIsolatedRepository, type DomainRepository } from "../domain/repository";
import { liveDomainRepository } from "../domain/prisma-repository";
import type { ModelMessage } from "ai";
import type { ProviderSettings } from "../releases/provider-settings";
import type { RunBinding } from "../storage/prisma-store";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { withoutPayloadTracing } from "./tracing";
import { executeGraph } from "./graph-run";
import { graphCheckpointer } from "./checkpointer";
import { AgentConfigSchema, RunRequestSchema, type AgentConfig, type AgentRunResult, type RunStep } from "../contracts";
import type { RunStore } from "../storage/prisma-store";
import { enabledTools, type ToolRegistry } from "../tools/registry";
import type { ModelDriver } from "./model";
import type { Checkpoint } from "./state";

export type RuntimeDependencies = {
  domain?: DomainRepository;
  driverForConfig?: (config: AgentConfig, settings?: ProviderSettings) => ModelDriver;
  checkpointer?: () => Promise<BaseCheckpointSaver>;
  store: RunStore; registry: ToolRegistry; driver: ModelDriver;
  signal?: AbortSignal; onEvent?: (event: RunStep) => void | Promise<void>;
};

export async function prepareAgentRun(options: {
  config: AgentConfig; ownerId: string; message: string; history?: ModelMessage[]; providerSettings?: ProviderSettings; binding?: RunBinding; approvalMode?: "human" | "deny";
}, deps: RuntimeDependencies) {
  const config = AgentConfigSchema.parse(options.config);
  if (config.ownerId !== options.ownerId) throw new Error("agent_not_found");
  const { message } = RunRequestSchema.parse({ message: options.message });
  enabledTools(config, deps.registry);
  if (deps.domain?.scope.kind === "evaluation" && !isIsolatedRepository(deps.domain)) throw new Error("evaluation_scope_unavailable");
  if (deps.domain && deps.domain.scope.ownerId !== options.ownerId) throw new Error("domain_owner_mismatch");
  deps = { ...deps, domain: deps.domain ?? liveDomainRepository(options.ownerId) };
  if (deps.driverForConfig) deps = { ...deps, driver: deps.driverForConfig(config, options.providerSettings) };
  deps = { ...deps, checkpointer: deps.checkpointer ?? graphCheckpointer };
  const state: Checkpoint = {
    schemaVersion: 1, domainScope: deps.domain!.scope, sessionId: options.binding?.sessionId, providerSettings: options.providerSettings, graphVersion: 1, toolResults: {}, budgetSpentUsd: 0, modelSteps: 0,
    messages: [...(options.history ?? []), { role: "user", content: message }], pending: [], seenCallIds: [],
    writeCalls: 0, modelCalls: 0, toolCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    startedAt: Date.now(), activeMs: 0, approvalMode: options.approvalMode ?? "human", driverKey: deps.driver.key,
  };
  const run = await deps.store.createRun(config, state, options.binding);
  return run;
}

export async function executePreparedRun(runId: string, ownerId: string, deps: RuntimeDependencies): Promise<AgentRunResult> {
  const loaded = await deps.store.loadRun(runId, ownerId);
  if (deps.driverForConfig) deps = { ...deps, driver: deps.driverForConfig(loaded.config, loaded.state.providerSettings) };
  deps = { ...deps, checkpointer: deps.checkpointer ?? graphCheckpointer };
  return withoutPayloadTracing(() => executeGraph(runId, ownerId, deps, undefined, "run_started"));
}

export async function runAgent(options: Parameters<typeof prepareAgentRun>[0], deps: RuntimeDependencies): Promise<AgentRunResult> {
  const run = await prepareAgentRun(options, deps);
  return executePreparedRun(run.id, options.ownerId, deps);
}

export async function resumeAgent(options: { approvalId: string; ownerId: string; approved: boolean }, deps: RuntimeDependencies) {
  const claim = await deps.store.claimApproval(options.approvalId, options.ownerId, options.approved);
  return resumeClaimedRun(claim, options.ownerId, options.approved, deps);
}

export async function resumeClaimedRun(claim: Awaited<ReturnType<RunStore["claimApproval"]>>, ownerId: string, approved: boolean,
  deps: RuntimeDependencies): Promise<AgentRunResult> {
  const runId = claim.approval.runId;
  const loaded = await deps.store.loadRun(runId, ownerId);
  if (loaded.status !== "running") throw new Error("run_unavailable");
  if (loaded.state.graphVersion !== 1) {
    // A legacy snapshot has no durable graph cursor. Do not reconstruct/replay its effects.
    const reason = "checkpoint_upgrade_required";
    const event = await deps.store.finishRun(runId, ownerId, loaded.version, loaded.state, "blocked", null, reason);
    for (const saved of [claim.event, event]) {
      try { await deps.onEvent?.(saved); } catch { /* Durable history can be replayed. */ }
    }
    return { runId, status: "blocked", response: null, stopReason: reason, usage: loaded.state.usage };
  }
  deps = { ...deps, checkpointer: deps.checkpointer ?? graphCheckpointer };
  return withoutPayloadTracing(() => executeGraph(runId, ownerId, deps, {
    call: { toolCallId: claim.approval.toolCallId, toolId: claim.approval.toolId, input: claim.approval.input },
    approved, inputHash: claim.approval.inputHash,
  }, claim.event));
}
