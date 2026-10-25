import type { TestCaseInput } from "@/lib/evals/schema";
import { runtimeTools } from "@/lib/integrations/runtime-tools";

export type ToolCatalogEntry = {
  id: string;
  description: string;
  kind: "read" | "write";
  requiresApproval: boolean;
};

// Single source of truth for the builder's tool picker, derived from the
// runtime registry so the UI never drifts from what actually runs.
export const toolCatalog: ToolCatalogEntry[] = runtimeTools.map((tool) => ({
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
  testCases?: TestCaseInput[];
};

export const agentTemplates: AgentTemplate[] = [
  {
    key: "acmestore-support",
    label: "AcmeStore Support",
    name: "AcmeStore Support",
    instructions:
      "You are AcmeStore's support agent. Answer customer questions using the company policy returned by knowledge_search. Never invent policy. For refund requests, use send_email to record an email to support@acmestore.example asking for manager review; human approval is mandatory and no actual refund or email is sent.",
    enabledTools: ["knowledge_search", "send_email"],
    testCases: [
      { input: "Use knowledge_search: can I return an unused jacket after 20 days?", mustCall: ["knowledge_search"], mustNotCall: ["send_email"], mustContain: ["30"], useGrader: false, source: "template" },
      { input: "Use knowledge_search and explain standard shipping times.", mustCall: ["knowledge_search"], mustNotCall: [], mustContain: ["business days"], useGrader: false, source: "template" },
      { input: "Refund order 1042. Request manager review by recording an email to support@acmestore.example.", mustCall: ["send_email"], mustNotCall: [], mustContain: [], useGrader: false, source: "template" },
    ],
  },
  {
    key: "competitor-pricing-analyst",
    label: "Competitor Pricing Analyst",
    name: "Competitor Pricing Analyst",
    instructions:
      "You are a pricing analyst. Use sales_lookup to pull the prepared sales figures and summarize units, revenue, and per-product trends. For competitor comparisons, use google_shopping. Base every number on retrieved data; do not estimate or fabricate figures.",
    enabledTools: ["sales_lookup", "google_shopping"],
    testCases: [
      { input: "Use sales_lookup and list our top 3 products by units sold.", mustCall: ["sales_lookup"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
      { input: "Use google_shopping with query organic cotton tee to find competitor prices.", mustCall: ["google_shopping"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
      { input: "Look up the price and units sold of our Organic Cotton Tee using sales_lookup.", mustCall: ["sales_lookup"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
    ],
  },
];

export function templateByKey(key: string): AgentTemplate | undefined {
  return agentTemplates.find((template) => template.key === key);
}
