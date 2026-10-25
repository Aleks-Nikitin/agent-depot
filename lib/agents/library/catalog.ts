import type { TestCaseInput } from "@/lib/evals/schema";
import { runtimeTools } from "@/lib/integrations/runtime-tools";

export type ToolCatalogEntry = {
  id: string;
  description: string;
  kind: "read" | "write";
  requiresApproval: boolean;
  deliveryMode?: "record" | "brevo";
};

// Single source of truth for the builder's tool picker, derived from the
// runtime registry so the UI never drifts from what actually runs.
export const toolCatalog: ToolCatalogEntry[] = runtimeTools.map((tool) => ({
  id: tool.id,
  description: tool.id === "send_email" ? "Send a support acknowledgement or request review for an existing ticket. Automatic messages use fixed templates; custom messages need review." : tool.description,
  ...(tool.id === "send_email" ? { deliveryMode: process.env.EMAIL_DELIVERY_MODE === "brevo" ? "brevo" as const : "record" as const } : {}),
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
    key: "customer-support",
    label: "Customer Support",
    name: "{{workspace}}'s Customer Support",
    instructions:
      "You are {{workspace}}'s customer support agent. Search knowledge_search before answering store-policy questions. Treat uploaded workspace documents as authoritative; label sample results as illustrative and never claim they are the store's real policy. Never invent policy, promise refunds, process payments or request passwords. For follow-up requests, create_ticket with a concise factual subject. Use send_email only when explicitly requested and its server delivery restrictions permit it. For automatic email first create_ticket, then use template support_acknowledgement or review_request with that returned ticketId and the explicitly requested recipient. Do not invent ticket IDs. A successful tool result, not your intention, determines whether an action happened.",
    enabledTools: ["knowledge_search", "create_ticket", "send_email"],
    testCases: [
      { input: "Use knowledge_search: can I return an unused jacket after 20 days?", mustCall: ["knowledge_search"], mustNotCall: ["send_email"], mustContain: ["30"], useGrader: false, source: "template" },
      { input: "Use knowledge_search and explain standard shipping times.", mustCall: ["knowledge_search"], mustNotCall: [], mustContain: ["business days"], useGrader: false, source: "template" },
      { input: "Create a support ticket requesting review of order 1042.", mustCall: ["create_ticket"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
    ],
  },
  {
    key: "competitor-pricing-analyst",
    label: "Competitor Pricing Analyst",
    name: "{{workspace}}'s Pricing Analyst",
    instructions:
      "You are {{workspace}}'s pricing analyst. Prepared sales are sample data: always label them illustrative; they are not real store revenue. Use sales_lookup to pull the prepared sales figures and summarize units, revenue, and per-product trends. For competitor comparisons, use google_shopping. Base every number on retrieved data; do not estimate or fabricate figures.",
    enabledTools: ["sales_lookup", "google_shopping"],
    testCases: [
      { input: "Use sales_lookup and list our top 3 products by units sold.", mustCall: ["sales_lookup"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
      { input: "Use google_shopping with query organic cotton tee to find competitor prices.", mustCall: ["google_shopping"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
      { input: "Look up the price and units sold of our Organic Cotton Tee using sales_lookup.", mustCall: ["sales_lookup"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
    ],
  },
];

export function templateByKey(key: string): AgentTemplate | undefined {
  return agentTemplates.find((template) => template.key === (key === "acmestore-support" ? "customer-support" : key));
}
