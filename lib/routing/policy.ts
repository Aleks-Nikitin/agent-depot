import { z } from "zod";
import { ModelProfileIdSchema, providerProfiles, resolveProfile, type ModelProfileId } from "@/lib/agents/profiles";

export const RoutingPolicySchema = z.object({
  version: z.literal(1), mode: z.enum(["locked", "lowest-estimated-cost"]),
  approvedProfiles: z.array(ModelProfileIdSchema).min(1).max(2).refine(a => new Set(a).size === a.length),
  lockedProfile: ModelProfileIdSchema.optional(),
  minContextTokens: z.number().int().min(1024).max(2_000_000),
  allowedProviders: z.array(z.enum(["google", "openai"])).min(1).max(2),
  dataPolicyTag: z.string().trim().min(1).max(50),
  maxExpectedLatencyMs: z.number().int().min(100).max(120_000),
  maxCostTier: z.enum(["economy", "standard", "premium"]),
}).strict().superRefine((p, ctx) => {
  if (p.mode === "locked" && (!p.lockedProfile || !p.approvedProfiles.includes(p.lockedProfile))) ctx.addIssue({ code: "custom", path: ["lockedProfile"], message: "Lock an approved profile" });
});
export type RoutingPolicy = z.infer<typeof RoutingPolicySchema>;
export const RoutingCatalogSchema = z.partialRecord(ModelProfileIdSchema, z.object({
  model: z.string().min(1).max(100), contextTokens: z.number().int().min(1024).max(2_000_000),
  tools: z.boolean(), expectedLatencyMs: z.number().int().min(1).max(120_000),
  costTier: z.enum(["economy", "standard", "premium"]), dataPolicyTag: z.string().min(1).max(50),
}).strict());
const tiers = { economy: 0, standard: 1, premium: 2 };
export function routingCatalog(raw: string | undefined) {
  try { return RoutingCatalogSchema.parse(JSON.parse(raw ?? "{}")); } catch { throw new Error("routing_catalog_invalid"); }
}
/** Operator declarations are constraints, not measured guarantees or provider retention claims. */
export function selectRoute(config: { routing?: RoutingPolicy; enabledTools: string[]; limits: { maxOutputTokens: number } }, env: Record<string, string | undefined>) {
  if (!config.routing) return null;
  const policy = RoutingPolicySchema.parse(config.routing); const catalog = routingCatalog(env.ROUTING_PROFILE_CATALOG);
  const candidates = policy.approvedProfiles.map(id => {
    const metadata = catalog[id];
    try {
      const profile = resolveProfile(id, { ...env, [providerProfiles[id].credential]: "validation-only" });
      const reason = !metadata ? "missing_declaration" : metadata.model !== profile.model ? "model_declaration_mismatch"
        : !policy.allowedProviders.includes(profile.provider) ? "provider_disallowed"
        : metadata.dataPolicyTag !== policy.dataPolicyTag ? "data_policy_mismatch"
        : config.enabledTools.length && !metadata.tools ? "tools_unsupported"
        : metadata.contextTokens < policy.minContextTokens ? "context_too_small"
        : metadata.expectedLatencyMs > policy.maxExpectedLatencyMs ? "latency_tier_exceeded"
        : tiers[metadata.costTier] > tiers[policy.maxCostTier] ? "cost_tier_exceeded" : null;
      const estimate = (policy.minContextTokens * profile.rates.input + config.limits.maxOutputTokens * profile.rates.output) / 1_000_000;
      return { id, eligible: reason === null, reason, estimate, contextTokens: metadata?.contextTokens ?? 0 };
    } catch { return { id, eligible: false, reason: "profile_unconfigured", estimate: null, contextTokens: 0 }; }
  });
  const eligible = candidates.filter(c => c.eligible);
  const selected = policy.mode === "locked" ? eligible.find(c => c.id === policy.lockedProfile)
    : eligible.sort((a, b) => a.estimate! - b.estimate! || a.id.localeCompare(b.id))[0];
  if (!selected) throw new Error("routing_no_eligible_profile");
  return { version: 1 as const, selectedProfile: selected.id as ModelProfileId,
    reason: policy.mode === "locked" ? "owner_locked" as const : "lowest_declared_context_cost" as const, candidates };
}

export const RoutingDecisionSchema = z.object({ version: z.literal(1), selectedProfile: ModelProfileIdSchema,
  reason: z.enum(["owner_locked", "lowest_declared_context_cost"]), candidates: z.array(z.object({
    id: ModelProfileIdSchema, eligible: z.boolean(), reason: z.string().nullable(), estimate: z.number().nullable(), contextTokens: z.number().int(),
  }).strict()).max(2),
}).strict();
