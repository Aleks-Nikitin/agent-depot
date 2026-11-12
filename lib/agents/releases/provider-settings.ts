import { z } from "zod";
import { modelProfileId, ModelProfileIdSchema, providerProfiles, resolveProfile } from "../profiles";
import type { AgentConfig } from "../contracts";

// Allowlist only model/pricing/recovery metadata. Credentials are resolved afresh on the server.
const keys = ["RUNTIME_MODEL_ID", "RUNTIME_INPUT_USD_PER_MILLION", "RUNTIME_OUTPUT_USD_PER_MILLION",
  "OPENAI_RUNTIME_MODEL_ID", "OPENAI_RUNTIME_INPUT_USD_PER_MILLION", "OPENAI_RUNTIME_OUTPUT_USD_PER_MILLION",
  "RUNTIME_FALLBACK_PROFILE", "RUNTIME_MODEL_MAX_RETRIES"] as const;
export const ProviderSettingsSchema = z.object(Object.fromEntries(keys.map(key => [key, z.string().max(100)])) as Record<typeof keys[number], z.ZodString>).extend({ ROUTING_PROFILE_CATALOG: z.string().max(8000).optional() }).strict();
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;
export function captureProviderSettings(config: AgentConfig, env: NodeJS.ProcessEnv = process.env): ProviderSettings {
  const settings = ProviderSettingsSchema.parse(Object.fromEntries(keys.map(key => [key, env[key] ?? ""])));
  if (config.routing) settings.ROUTING_PROFILE_CATALOG = z.string().max(8000).parse(env.ROUTING_PROFILE_CATALOG ?? "{}");
  settings.RUNTIME_MODEL_MAX_RETRIES ||= "1";
  z.coerce.number().int().min(0).max(2).parse(settings.RUNTIME_MODEL_MAX_RETRIES);
  const primary = modelProfileId(config);
  const selected = config.fallbackModelProfile ?? settings.RUNTIME_FALLBACK_PROFILE;
  const fallback = selected ? ModelProfileIdSchema.parse(selected) : undefined;
  if (fallback === primary) throw new Error("invalid_fallback_profile");
  for (const id of [primary, ...(fallback ? [fallback] : [])]) {
    resolveProfile(id, { ...settings, [providerProfiles[id].credential]: "validation-only" });
  }
  return settings;
}
