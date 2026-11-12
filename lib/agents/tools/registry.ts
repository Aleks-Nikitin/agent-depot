import { isIsolatedRepository, type DomainRepository } from "../domain/repository";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { AgentConfig } from "../contracts";

export type ToolContext = {
  ownerId: string; runId: string; toolCallId: string; signal: AbortSignal;
  config?: AgentConfig;
  domain?: DomainRepository;
  idempotencyKey: string;
};
export type ToolDefinition = {
  implementationVersion?: string;
  id: string; description: string; kind: "read" | "write";
  inputSchema: z.ZodType;
  outputSchema?: z.ZodType;
  domainScoped?: boolean;
  automaticWrites?: boolean;
  approvalExempt?: boolean;
  unavailable?: () => string | null;
  external?: boolean;
  available?: (config: AgentConfig) => Promise<boolean>;
  retired?: boolean;
  canAutoWrite?: (input: unknown) => boolean;
  run(input: unknown, context: ToolContext): Promise<unknown>;
};
export type ToolRegistry = ReadonlyMap<string, ToolDefinition>;
export function createRegistry(tools: ToolDefinition[]): ToolRegistry {
  const registry = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (registry.has(tool.id)) throw new Error("duplicate_tool");
    registry.set(tool.id, tool);
  }
  return registry;
}
export function enabledTools(config: AgentConfig, registry: ToolRegistry): ToolDefinition[] {
  return [...new Set(config.enabledTools)].map(id => {
    const tool = registry.get(id);
    if (!tool) throw new Error("unknown_tool");
    return tool;
  });
}
export function permittedTool(config: AgentConfig, registry: ToolRegistry, id: string) {
  if (!config.enabledTools.includes(id)) throw new Error("disabled_tool");
  const tool = registry.get(id);
  if (!tool) throw new Error("unknown_tool");
  return tool;
}

export async function availableTools(config: AgentConfig, registry: ToolRegistry, domain?: DomainRepository) {
  const candidates = enabledTools(config, registry);
  const available = await Promise.all(candidates.map(async tool => !tool.retired && !tool.unavailable?.()
    && !(tool.external && domain?.scope.kind !== "live") && (!tool.available || await tool.available(config))));
  return candidates.filter((_, index) => available[index]).map(tool => tool.external && config.github?.repository
    ? { ...tool, description: `${tool.description} Approved repository: ${config.github.repository}.` } : tool);
}

export async function dispatchTool(options: {
  config: AgentConfig; registry: ToolRegistry; toolId: string; input: unknown;
  context: ToolContext; writeApproved?: boolean;
}) {
  const { config, registry, toolId, input, context } = options;
  context.signal.throwIfAborted();
  if (context.ownerId !== config.ownerId || (context.domain && context.domain.scope.ownerId !== context.ownerId)) throw new Error("domain_owner_mismatch");
  if (context.domain?.scope.kind === "evaluation" && !isIsolatedRepository(context.domain)) throw new Error("evaluation_scope_unavailable");
  const tool = permittedTool(config, registry, toolId);
  if (tool.external && context.domain?.scope.kind !== "live") throw new Error("evaluation_external_tool_disabled");
  if (tool.available && !await tool.available(config)) throw new Error("connector_scope_changed");
  if (tool.domainScoped && !context.domain) throw new Error("domain_scope_required");
  const parsed = tool.inputSchema.parse(input);
  if (tool.kind === "write" && !options.writeApproved) throw new Error("approval_required");
  if (tool.kind === "write" && !isDeepStrictEqual(parsed, input)) throw new Error("approval_input_changed");
  const rawResult = await tool.run(parsed, { ...context, config });
  const result = tool.outputSchema ? tool.outputSchema.parse(rawResult) : rawResult;
  context.signal.throwIfAborted();
  if (context.ownerId !== config.ownerId || (context.domain && context.domain.scope.ownerId !== context.ownerId)) throw new Error("domain_owner_mismatch");
  const json = JSON.stringify(result);
  if (json === undefined || Buffer.byteLength(json) > 32_768) throw new Error("invalid_tool_output");
  // Normalize to actual JSON; no functions, BigInts, or undefined fields escape.
  return JSON.parse(json) as unknown;
}
