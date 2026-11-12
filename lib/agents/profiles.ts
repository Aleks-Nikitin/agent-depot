import { z } from "zod";

export const ModelProfileIdSchema = z.enum(["gemini-primary", "openai-fallback"]);
export type ModelProfileId = z.infer<typeof ModelProfileIdSchema>;
export const providerProfiles = {
  "gemini-primary": { provider: "google", credential: "GOOGLE_GENERATIVE_AI_API_KEY", role: "primary" },
  "openai-fallback": { provider: "openai", credential: "OPENAI_API_KEY", role: "fallback" },
} as const;

// Legacy model: gemini remains readable; profiles are selected from trusted IDs.
export function modelProfileId(config: { model: "gemini"; modelProfile?: ModelProfileId }): ModelProfileId {
  return config.modelProfile ?? "gemini-primary";
}
export function resolveProfile(id: ModelProfileId, env: Record<string, string | undefined> = process.env) {
  const spec = providerProfiles[id];
  const google = spec.provider === "google";
  const model = z.string().min(1).max(100).parse(google ? env.RUNTIME_MODEL_ID : env.OPENAI_RUNTIME_MODEL_ID);
  const rates = z.object({ input: z.coerce.number().positive(), output: z.coerce.number().positive() }).parse({
    input: google ? env.RUNTIME_INPUT_USD_PER_MILLION : env.OPENAI_RUNTIME_INPUT_USD_PER_MILLION,
    output: google ? env.RUNTIME_OUTPUT_USD_PER_MILLION : env.OPENAI_RUNTIME_OUTPUT_USD_PER_MILLION,
  });
  const apiKey = env[spec.credential];
  if (!apiKey) throw new Error("model_credentials_missing");
  return { id, ...spec, model, rates, apiKey };
}
