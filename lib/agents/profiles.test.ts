import { expect, it } from "vitest";
import { AgentConfigSchema } from "./contracts";
import { supportAgent } from "./fixtures";
import { modelProfileId, providerProfiles, resolveProfile } from "./profiles";

it("preserves legacy Gemini configs and validates explicit provider selection without a silent fallback", () => {
  expect(modelProfileId(AgentConfigSchema.parse(supportAgent))).toBe("gemini-primary");
  const config = AgentConfigSchema.parse({ ...supportAgent, modelProfile: "openai-fallback" });
  expect(providerProfiles[modelProfileId(config)].provider).toBe("openai");
  expect(() => AgentConfigSchema.parse({ ...supportAgent, modelProfile: "untrusted" })).toThrow();
  expect(() => resolveProfile("openai-fallback", {})).toThrow();
});
