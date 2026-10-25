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
const usage = { inputTokens: 100, outputTokens: 30, estimatedCostUsd: 0.0001 };
const totalUsage = { inputTokens: 200, outputTokens: 60, estimatedCostUsd: 0.0002 };
const writeCall = { toolId: "create_ticket", toolCallId: "write-1", input: { subject: "Return request" } };
const waiting = [start,
  event(2, "model_started", { step: 1 }), event(3, "model_finished", usage),
  event(4, "tool_requested", writeCall),
  event(5, "approval_required", { ...writeCall, approvalId: "approval-1", expiresAt: "2026-10-24T19:00:00.000Z" }),
];
export const eventFixtures = {
  success: [start,
    event(2, "model_started", { step: 1 }), event(3, "model_finished", usage),
    event(4, "tool_requested", { toolId: "knowledge_search", toolCallId: "call-1", input: { query: "returns" } }),
    event(5, "tool_started", { toolId: "knowledge_search", toolCallId: "call-1", input: { query: "returns" } }),
    event(6, "tool_finished", { toolId: "knowledge_search", toolCallId: "call-1", output: { text: "Returns within 30 days." }, durationMs: 10 }),
    event(7, "model_started", { step: 2 }), event(8, "model_finished", usage),
    event(9, "run_completed", { response: "Returns are allowed within 30 days.", durationMs: 100, usage: totalUsage })],
  waiting,
  rejected: [...waiting,
    event(6, "approval_resolved", { approvalId: "approval-1", approved: false, toolCallId: "write-1" }),
    event(7, "tool_failed", { toolCallId: "write-1", toolId: "create_ticket", reason: "write_denied" }),
    event(8, "model_started", { step: 2 }), event(9, "model_finished", usage),
    event(10, "run_completed", { response: "The change was not approved.", durationMs: 100, usage: totalUsage })],
  approved: [...waiting,
    event(6, "approval_resolved", { approvalId: "approval-1", approved: true, toolCallId: "write-1" }),
    event(7, "tool_started", writeCall),
    event(8, "tool_finished", { toolCallId: "write-1", toolId: "create_ticket", output: { id: "ticket-1", subject: "Return request" }, durationMs: 10 }),
    event(9, "model_started", { step: 2 }), event(10, "model_finished", usage),
    event(11, "run_completed", { response: "The ticket was created.", durationMs: 100, usage: totalUsage })],
  stepLimit: [start, event(2, "model_started", { step: 1 }), event(3, "model_finished", usage),
    event(4, "run_blocked", { reason: "step_limit" })],
  budgetLimit: [start, event(2, "run_blocked", { reason: "budget_limit" })],
  error: [start, event(2, "model_started", { step: 1 }), event(3, "run_failed", { reason: "execution_failed" })],
};
