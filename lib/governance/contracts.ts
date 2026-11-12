import { z } from "zod";
import { ModelProfileIdSchema } from "@/lib/agents/profiles";
export const GovernanceBindingSchema = z.object({
  teamId: z.string().uuid(), organizationRevision: z.number().int().positive(), teamRevision: z.number().int().positive(),
  packs: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(2).default([]),
}).strict();
export const EffectiveGovernanceSchema = z.object({
  organizationId: z.string(), organizationName: z.string(), organizationRevision: z.number().int(),
  teamId: z.string(), teamName: z.string(), teamRevision: z.number().int(),
  allowedProfiles: z.array(ModelProfileIdSchema), allowedRepositories: z.array(z.string()), mandatoryRules: z.array(z.string()),
  requireWriteApproval: z.boolean(), packs: z.array(z.object({ id: z.string(), version: z.number().int(), hash: z.string() })),
}).strict();
