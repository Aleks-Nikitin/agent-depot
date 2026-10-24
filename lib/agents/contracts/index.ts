import { z } from "zod";

export const LimitsSchema = z.object({
  maxModelCalls: z.number().int().min(1).max(10).default(5),
  maxToolCalls: z.number().int().min(1).max(20).default(10),
  maxEstimatedCostUsd: z.number().positive().max(1).default(0.05),
  maxOutputTokens: z.number().int().min(1).max(2048).default(512),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
});
export const AgentConfigSchema = z.object({
  id: z.string().min(1).max(100),
  ownerId: z.string().min(1).max(100),
  version: z.number().int().positive(),
  name: z.string().min(1).max(100),
  instructions: z.string().min(1).max(8000),
  model: z.literal("gemini"),
  enabledTools: z.array(z.string().min(1).max(100)).max(10),
  requireWriteApproval: z.literal(true).default(true),
  limits: LimitsSchema.default(() => LimitsSchema.parse({})),
}).strict();
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export const RunRequestSchema = z.object({ message: z.string().trim().min(1).max(8000) }).strict();
export const ApprovalRequestSchema = z.object({ approved: z.boolean() }).strict();
export const RunStatusSchema = z.enum(["running", "waiting_approval", "completed", "blocked", "failed"]);
export const UsageSchema = z.object({
  inputTokens: z.number().nonnegative().nullable(),
  outputTokens: z.number().nonnegative().nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
});
export type Usage = z.infer<typeof UsageSchema>;
const envelope = z.object({
  schemaVersion: z.literal(1), eventId: z.string(), runId: z.string(),
  sequence: z.number().int().positive(), timestamp: z.iso.datetime(),
});
const call = z.object({ toolCallId: z.string(), toolId: z.string(), input: z.unknown() });
export const RunStepSchema = z.discriminatedUnion("type", [
  envelope.extend({ type: z.literal("run_started"), payload: z.object({ agentId: z.string() }) }),
  envelope.extend({ type: z.literal("model_started"), payload: z.object({ step: z.number().int() }) }),
  envelope.extend({ type: z.literal("model_finished"), payload: UsageSchema }),
  envelope.extend({ type: z.literal("tool_requested"), payload: call }),
  envelope.extend({ type: z.literal("tool_started"), payload: call }),
  envelope.extend({ type: z.literal("tool_finished"), payload: z.object({ toolCallId: z.string(), toolId: z.string(), output: z.unknown(), durationMs: z.number().nonnegative() }) }),
  envelope.extend({ type: z.literal("tool_failed"), payload: z.object({ toolCallId: z.string(), toolId: z.string(), reason: z.string() }) }),
  envelope.extend({ type: z.literal("approval_required"), payload: call.extend({ approvalId: z.string(), expiresAt: z.iso.datetime() }) }),
  envelope.extend({ type: z.literal("approval_resolved"), payload: z.object({ approvalId: z.string(), approved: z.boolean(), toolCallId: z.string() }) }),
  envelope.extend({ type: z.literal("run_blocked"), payload: z.object({ reason: z.string() }) }),
  envelope.extend({ type: z.literal("run_failed"), payload: z.object({ reason: z.string() }) }),
  envelope.extend({ type: z.literal("run_completed"), payload: z.object({ response: z.string(), durationMs: z.number().nonnegative(), usage: UsageSchema }) }),
]);
export type RunStep = z.infer<typeof RunStepSchema>;
export type EventInput = RunStep extends infer E ? E extends RunStep ? Pick<E, "type" | "payload"> : never : never;
export const AgentRunResultSchema = z.object({
  runId: z.string(), status: RunStatusSchema, response: z.string().nullable(),
  stopReason: z.string().nullable(), usage: UsageSchema,
});
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;
export const DraftSchema = z.object({
  name: z.string().min(1).max(100), instructions: z.string().min(1).max(8000),
  model: z.literal("gemini"),
  tools: z.array(z.object({ id: z.string(), reason: z.string().min(1), requiresApproval: z.boolean() })).max(10),
  assumptions: z.array(z.string()).max(10),
  suggestedTests: z.array(z.object({ input: z.string(), expectedBehavior: z.string() })).max(10),
});
export type AgentDraft = z.infer<typeof DraftSchema>;
