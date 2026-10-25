import { demoTools } from "@/lib/integrations/demo-tools";

export type ToolCatalogEntry = {
  id: string;
  description: string;
  kind: "read" | "write";
  requiresApproval: boolean;
};

// Single source of truth for the builder's tool picker, derived from the
// runtime registry so the UI never drifts from what actually runs.
export const toolCatalog: ToolCatalogEntry[] = demoTools.map((tool) => ({
  id: tool.id,
  description: tool.description,
  kind: tool.kind,
  requiresApproval: tool.kind === "write",
}));

export function toolEntry(id: string): ToolCatalogEntry | undefined {
  return toolCatalog.find((tool) => tool.id === id);
}

export type AgentTemplate = {
  key: string;
  label: string;
  name: string;
  instructions: string;
  enabledTools: string[];
};

export const agentTemplates: AgentTemplate[] = [
  {
    key: "acmestore-support",
    label: "AcmeStore Support",
    name: "AcmeStore Support",
    instructions:
      "You are AcmeStore's support agent. Answer customer questions using the company policy returned by knowledge_search. Never invent policy. If a customer needs a change that is not covered, create a support ticket with create_ticket (this requires human approval).",
    enabledTools: ["knowledge_search", "create_ticket"],
  },
  {
    key: "competitor-pricing-analyst",
    label: "Competitor Pricing Analyst",
    name: "Competitor Pricing Analyst",
    instructions:
      "You are a pricing analyst. Use sales_lookup to pull the prepared sales figures and summarize units, revenue, and per-product trends. Base every number on the dataset; do not estimate or fabricate figures.",
    enabledTools: ["sales_lookup"],
  },
];

export function templateByKey(key: string): AgentTemplate | undefined {
  return agentTemplates.find((template) => template.key === key);
}
