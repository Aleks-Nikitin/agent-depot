import { z } from "zod";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
export const MCP_TOOL_IDS = ["list_agents", "get_release_status", "get_test_summary"] as const;
export const McpToolIdSchema = z.enum(MCP_TOOL_IDS);
export const McpScopeSchema = z.object({ agentIds: z.array(z.string().uuid()).min(1).max(20), tools: z.array(McpToolIdSchema).min(1).max(3) }).strict();
export const McpKeyInputSchema = McpScopeSchema.extend({ name: z.string().trim().min(1).max(80), expiresDays: z.number().int().min(1).max(30) });
export const mcpInputs = {
  list_agents: z.object({}).strict(),
  get_release_status: z.object({ agentId: z.string().uuid() }).strict(),
  get_test_summary: z.object({ agentId: z.string().uuid() }).strict(),
};
export const mcpTools = [
  { name: "list_agents" as const, title: "List selected agents", description: "List up to 20 explicitly authorized owned agents. Returns names, draft versions and serving status; no instructions or private execution state." },
  { name: "get_release_status" as const, title: "Read serving release status", description: "Read the selected owned agent's serving pointer and draft version. This read-only tool cannot save, run, approve, publish or roll back an agent." },
  { name: "get_test_summary" as const, title: "Read latest evaluation summary", description: "Read the latest certification suite's historical status and aggregate counts. Stored passing results alone do not authorize publication. No prompts, answers or traces are exported." },
].map(t => ({ ...t, inputSchema: mcpInputs[t.name].toJSONSchema(), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
export const MCP_CATALOG_HASH = artifactHash(mcpTools);
export const MCP_PROTOCOLS = ["2025-11-25", "2025-06-18"] as const;
