import { AgentConfigSchema, RunStepSchema, type RunStep } from "../contracts";

export const supportAgent = AgentConfigSchema.parse({
  id: "support-demo", ownerId: "demo", version: 1, name: "Support",
  instructions: "Answer using the company policy returned by knowledge_search. Do not invent policies.",
  model: "gemini", enabledTools: ["knowledge_search", "create_ticket"],
});
export const salesAgent = AgentConfigSchema.parse({
  ...supportAgent, id: "sales-demo", name: "Sales", enabledTools: ["sales_lookup"],
  instructions: "Use sales_lookup to answer sales questions based on the prepared dataset.",
});

function event(sequence: number, type: string, payload: unknown): RunStep {
  return RunStepSchema.parse({ schemaVersion: 1, eventId: `fixture-${sequence}`, runId: "fixture-run",
    sequence, timestamp: "2026-10-24T18:00:00.000Z", type, payload });
}
const start = event(1, "run_started", { agentId: supportAgent.id });
const requested = event(2, "tool_requested", { toolId: "knowledge_search", toolCallId: "call-1", input: { query: "returns" } });
const usage = { inputTokens: 100, outputTokens: 30, estimatedCostUsd: 0.0001 };
export const eventFixtures = {
  success: [start, requested,
    event(3, "tool_started", requested.payload),
    event(4, "tool_finished", { toolId: "knowledge_search", toolCallId: "call-1", output: { text: "Returns within 30 days." }, durationMs: 10 }),
    event(5, "run_completed", { response: "Returns are allowed within 30 days.", durationMs: 100, usage })],
  waiting: [start, event(2, "tool_requested", { toolId: "create_ticket", toolCallId: "write-1", input: { subject: "Return request" } }), event(3, "approval_required", {
    toolId: "create_ticket", toolCallId: "write-1", input: { subject: "Return request" },
    approvalId: "approval-1", expiresAt: "2026-10-24T19:00:00.000Z",
  })],
  rejected: [start, event(2, "approval_resolved", { approvalId: "approval-1", approved: false, toolCallId: "write-1" }),
    event(3, "run_completed", { response: "The change was not approved.", durationMs: 100, usage })],
  stepLimit: [start, event(2, "run_blocked", { reason: "step_limit" })],
  budgetLimit: [start, event(2, "run_blocked", { reason: "budget_limit" })],
  error: [start, event(2, "run_failed", { reason: "provider_failure" })],
};
