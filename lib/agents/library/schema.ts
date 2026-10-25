import { z } from "zod";
import { LimitsSchema } from "@/lib/agents/contracts";
import { TestCaseInputSchema } from "@/lib/evals/schema";

// What the builder form submits. Server owns id / ownerId / version.
export const AgentInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    instructions: z.string().trim().min(1).max(8000),
    workspaceName: z.string().trim().min(1).max(80).optional(),
    model: z.literal("gemini").default("gemini"),
    enabledTools: z.array(z.string().min(1).max(100)).max(10).default([]),
    requireWriteApproval: z.boolean().default(true),
    limits: LimitsSchema.partial().optional(),
    testCases: z.array(TestCaseInputSchema).max(5).optional(),
  })
  .strict();
export type AgentInput = z.infer<typeof AgentInputSchema>;

export const RollbackRequestSchema = z
  .object({ version: z.number().int().positive() })
  .strict();

export const PublishRequestSchema = z
  .object({ testsPassed: z.boolean().optional() })
  .strict();
