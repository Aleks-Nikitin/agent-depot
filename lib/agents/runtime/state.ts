import { z } from "zod";
import type { ModelMessage } from "ai";
import { UsageSchema } from "../contracts";

export const PendingCallSchema = z.object({
  toolCallId: z.string(), toolId: z.string(), input: z.unknown(),
});
export type PendingCall = z.infer<typeof PendingCallSchema>;
export const CheckpointSchema = z.object({
  schemaVersion: z.literal(1),
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
