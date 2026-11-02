import { ProviderSettingsSchema } from "../releases/provider-settings";
import { z } from "zod";
import type { ModelMessage } from "ai";
import { UsageSchema } from "../contracts";

export const PendingCallSchema = z.object({
  toolCallId: z.string(), toolId: z.string(), input: z.unknown(),
});
export type PendingCall = z.infer<typeof PendingCallSchema>;
export const CheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().optional(),
  domainScope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("live"), ownerId: z.string() }),
    z.object({ kind: z.literal("evaluation"), ownerId: z.string(), attemptId: z.string(), knowledgeHash: z.string() }),
  ]).optional(),
  providerSettings: ProviderSettingsSchema.optional(),
  graphVersion: z.literal(1).optional(),
  approvalInterruptId: z.string().optional(),
  budgetSpentUsd: z.number().nonnegative().optional(),
  activeModel: z.string().optional(),
  activeProfile: z.string().optional(),
  activeDriverKey: z.string().optional(),
  modelSteps: z.number().int().nonnegative().optional(),
  toolResults: z.record(z.string(), z.unknown()).optional(),
  messages: z.array(z.custom<ModelMessage>()),
  pending: z.array(PendingCallSchema),
  seenCallIds: z.array(z.string()),
  writeCalls: z.number().int().nonnegative().default(0),
  modelCalls: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(),
  usage: UsageSchema, startedAt: z.number(), activeMs: z.number().nonnegative(),
  approvalMode: z.enum(["human", "deny"]),
  driverKey: z.string().default("test"),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
