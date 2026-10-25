import type { TestCaseInput } from "@/lib/evals/schema";
import { runtimeTools } from "@/lib/integrations/runtime-tools";

export type ToolCatalogEntry = {
  id: string;
  description: string;
  kind: "read" | "write";
  requiresApproval: boolean;
  unavailableReason?: string | null;
};

// Single source of truth for the builder's tool picker, derived from the
// runtime registry so the UI never drifts from what actually runs.
export const toolCatalog: ToolCatalogEntry[] = runtimeTools.filter(tool => !tool.retired).map((tool) => ({
  id: tool.id, description: tool.description, kind: tool.kind,
  requiresApproval: tool.kind === "write" && !tool.approvalExempt,
  unavailableReason: tool.unavailable?.() ?? null,
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
      "You are {{workspace}}'s customer support agent. Search knowledge_search before answering store-policy questions. Treat uploaded workspace documents as authoritative; label sample results as illustrative and never claim they are the store's real policy. Never invent policy, promise refunds, process payments or request passwords. For follow-up requests, create_ticket with a concise factual subject. External email, Slack and Discord delivery are not supported. Never promise a message will be sent. Tickets are internal workspace records visible in Tools & knowledge, not external helpdesk requests. A successful tool result, not your intention, determines whether an action happened.",
    enabledTools: ["knowledge_search", "create_ticket"],
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
  {
    key: "data-center-incident-responder",
    label: "Data Center Incident Responder",
    name: "{{workspace}}'s Incident Responder",
    instructions:
      "You are {{workspace}}'s data-center incident responder. When an incident is reported, search knowledge_search for the relevant runbook and summarize the exact step-by-step remediation it prescribes. Base every step on the retrieved runbook; never invent procedures. If the fix is risky or ambiguous, do not act on your own — open an incident ticket with create_ticket so a human on-call engineer approves and takes over. create_ticket requires human approval. Tickets are internal workspace records, not external pager alerts; a successful tool result, not your intention, determines whether an action happened.",
    enabledTools: ["knowledge_search", "create_ticket"],
    testCases: [
      { input: "Use knowledge_search: a rack cooling unit is reporting high temperature — what does the runbook say?", mustCall: ["knowledge_search"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
      { input: "Open an incident ticket to escalate a failing power supply in rack B12.", mustCall: ["create_ticket"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
      { input: "Use knowledge_search and explain the escalation steps for a network link failure.", mustCall: ["knowledge_search"], mustNotCall: [], mustContain: [], useGrader: false, source: "template" },
    ],
  },
  {
    key: "compute-capacity-planner",
    label: "Compute Capacity Planner",
    name: "{{workspace}}'s Capacity Planner",
    instructions:
      "You are {{workspace}}'s compute capacity planner. Use sales_lookup to pull the prepared utilization dataset (treat it as illustrative sample data, not live telemetry) and summarize usage, growth, and per-resource trends. For hardware or pricing comparisons, use google_shopping. Base every number on retrieved data; never estimate or fabricate figures. Flag resources trending toward capacity so a human can plan procurement.",
    enabledTools: ["sales_lookup", "google_shopping"],
    testCases: [
      { input: "Use sales_lookup and list the top resources by usage.", mustCall: ["sales_lookup"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
      { input: "Use google_shopping with query rackmount server to compare hardware prices.", mustCall: ["google_shopping"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
    ],
  },
  {
    key: "infra-oncall-agent",
    label: "Infra On-call Agent",
    name: "{{workspace}}'s On-call Agent",
    instructions:
      "You are {{workspace}}'s infrastructure on-call assistant. For an alert, first search knowledge_search for the matching runbook and summarize its steps. Use read_webpage to check a referenced status or dashboard page when a URL is provided. Base every recommendation on retrieved sources; never invent status or steps. For any action that changes production or needs sign-off, open an incident ticket with create_ticket for human approval instead of acting. A successful tool result, not your intention, determines whether an action happened.",
    enabledTools: ["knowledge_search", "read_webpage", "create_ticket"],
    testCases: [
      { input: "Use knowledge_search: what is the runbook for a disk-full alert on a storage node?", mustCall: ["knowledge_search"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
      { input: "Open an incident ticket to escalate a degraded storage node.", mustCall: ["create_ticket"], mustNotCall: ["send_email"], mustContain: [], useGrader: false, source: "template" },
    ],
  },
];

export function templateByKey(key: string): AgentTemplate | undefined {
  return agentTemplates.find((template) => template.key === (key === "acmestore-support" ? "customer-support" : key));
}
