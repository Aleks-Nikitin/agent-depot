import { z } from "zod";
import { getDb } from "@/lib/db/prisma";
import { createRegistry, type ToolDefinition } from "@/lib/agents/tools/registry";
import { demoTools } from "./demo-tools";
import { integrationTools } from "./index";
import { knowledgeDocs } from "./data/knowledge";
import { searchKnowledge } from "./knowledgeSearch";

export const runtimeTools: ToolDefinition[] = Object.values(integrationTools).map(tool => ({
  id: tool.id, description: tool.description,
  kind: tool.kind,
  retired: tool.id === "send_email",
  unavailable: ["google_shopping", "google_news", "read_webpage"].includes(tool.id) ? () => process.env.SERPAPI_API_KEY ? null : "search_not_configured" : undefined,
  // Keep the retired ID readable for old saved agents, but never advertise or execute it.
  inputSchema: tool.id === "send_email" ? z.object({}).strict() : tool.input,
  async run(input, context) {
    context.signal.throwIfAborted();
    if (tool.id === "knowledge_search") {
      const own = await getDb().knowledgeDocument.findMany({ where: { ownerId: context.ownerId }, orderBy: { createdAt: "desc" }, take: 100 });
      return { ...searchKnowledge(input, own.length ? own : knowledgeDocs), dataKind: own.length ? "workspace_documents" : "illustrative_sample", sample: !own.length };
    }
    if (tool.id === "send_email") {
      throw new Error("email_removed");
    }
    const result = await tool.run(input, { signal: context.signal });
    if (result && typeof result === "object" && "error" in result) throw new Error(String(result.error));
    return result;
  },
}));
// Keep saved configurations using the original local ticket integration compatible.
runtimeTools.push(...demoTools.filter(tool => tool.id === "create_ticket"));
export const runtimeRegistry = createRegistry(runtimeTools);
