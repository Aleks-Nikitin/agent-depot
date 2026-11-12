import { expect, it } from "vitest";
import { selectRoute, type RoutingPolicy } from "./policy";
export const policy: RoutingPolicy = { version: 1, mode: "lowest-estimated-cost", approvedProfiles: ["gemini-primary", "openai-fallback"], minContextTokens: 8192,
  allowedProviders: ["google", "openai"], dataPolicyTag: "approved-public", maxExpectedLatencyMs: 10000, maxCostTier: "standard" };
export const catalog = { "gemini-primary": { model: "gemini-3.1-flash-lite", contextTokens: 32000, tools: true, expectedLatencyMs: 1000, costTier: "standard", dataPolicyTag: "approved-public" },
  "openai-fallback": { model: "fixture-openai", contextTokens: 16000, tools: true, expectedLatencyMs: 2000, costTier: "economy", dataPolicyTag: "approved-public" } };
export const env = { RUNTIME_MODEL_ID: "gemini-3.1-flash-lite", RUNTIME_INPUT_USD_PER_MILLION: ".1", RUNTIME_OUTPUT_USD_PER_MILLION: ".4",
  OPENAI_RUNTIME_MODEL_ID: "fixture-openai", OPENAI_RUNTIME_INPUT_USD_PER_MILLION: ".01", OPENAI_RUNTIME_OUTPUT_USD_PER_MILLION: ".04", ROUTING_PROFILE_CATALOG: JSON.stringify(catalog) };
it("selects only explicitly eligible profiles, honors owner lock and never changes selection when a credential disappears", () => {
  const config = { routing: policy, enabledTools: ["create_ticket"], limits: { maxOutputTokens: 512 } };
  expect(selectRoute(config, env)?.selectedProfile).toBe("openai-fallback");
  expect(selectRoute({ ...config, routing: { ...policy, mode: "locked", lockedProfile: "gemini-primary" } }, env)?.reason).toBe("owner_locked");
  for (const override of [{ tools: false }, { contextTokens: 1024 }, { expectedLatencyMs: 20000 }, { costTier: "premium" }, { dataPolicyTag: "other" }, { model: "another-model" }]) {
    expect(selectRoute(config, { ...env, ROUTING_PROFILE_CATALOG: JSON.stringify({ ...catalog, "openai-fallback": { ...catalog["openai-fallback"], ...override } }) })?.selectedProfile).toBe("gemini-primary");
  }
  expect(selectRoute({ ...config, routing: { ...policy, allowedProviders: ["google"] } }, env)?.selectedProfile).toBe("gemini-primary");
  expect(() => selectRoute(config, { ...env, ROUTING_PROFILE_CATALOG: "{}" })).toThrow("routing_no_eligible_profile");
  expect(selectRoute({ ...config, routing: undefined }, env)).toBeNull();
});
