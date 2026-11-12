import { z } from "zod";
export const KnowledgeSourceSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().max(500), text: z.string().max(100_000),
  version: z.number().int().positive().optional(), sourceName: z.string().max(200).nullable().optional(), contentHash: z.string().max(64).optional(),
}).strict();
export const KnowledgeInputSchema = z.object({
  title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(100_000),
  access: z.enum(["workspace", "agents"]).default("workspace"), agentIds: z.array(z.string().min(1).max(100)).max(30).default([]),
}).strict().refine(v => v.access !== "agents" || v.agentIds.length > 0, "Select at least one agent for restricted access");
