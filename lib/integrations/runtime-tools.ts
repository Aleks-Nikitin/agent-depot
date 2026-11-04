import { z } from "zod";
import { createRegistry, type ToolDefinition } from "@/lib/agents/tools/registry";
import { demoTools } from "./demo-tools";
import { integrationTools } from "./index";
import { lookupSales } from "./salesLookup";
import { searchKnowledge } from "./knowledgeSearch";

export const runtimeTools: ToolDefinition[] = Object.values(integrationTools).map(tool => ({
  implementationVersion: "domain-tools-v1",
  id: tool.id, description: tool.description,
  kind: tool.kind,
  domainScoped: ["knowledge_search", "sales_lookup"].includes(tool.id),
  retired: tool.id === "send_email",
  unavailable: ["google_shopping", "google_news", "read_webpage"].includes(tool.id) ? () => process.env.SERPAPI_API_KEY ? null : "search_not_configured" : undefined,
  // Keep the retired ID readable for old saved agents, but never advertise or execute it.
  inputSchema: tool.id === "send_email" ? z.object({}).strict() : tool.input,
  async run(input, context) {
    context.signal.throwIfAborted();
    if (tool.id === "knowledge_search") {
      if (!context.domain) throw new Error("domain_scope_required");
      const { documents, sample } = await context.domain.knowledge();
      return { ...searchKnowledge(input, documents), dataKind: sample ? "illustrative_sample" : "workspace_documents", sample };
    }
    if (tool.id === "sales_lookup") {
      if (!context.domain) throw new Error("domain_scope_required");
      return lookupSales(input, await context.domain.products());
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
runtimeTools.push({
  implementationVersion: "domain-tools-v1",
  id: "order_lookup", description: "Look up an order in the current workspace. Missing orders return no record; no external shop is connected.",
  kind: "read", domainScoped: true, inputSchema: z.object({ orderId: z.string().trim().min(1).max(100) }).strict(),
  async run(input, context) {
    if (!context.domain) throw new Error("domain_scope_required");
    const { orderId } = z.object({ orderId: z.string() }).parse(input);
    return { order: await context.domain.order(orderId) };
  },
});
export const runtimeRegistry = createRegistry(runtimeTools);
