import { afterEach, expect, it, vi } from "vitest";
import { createGoogleDriver } from "./model";
import { googleDraftGenerator } from "./draft";
import { supportAgent } from "../fixtures";
import { demoRegistry } from "../../integrations/demo-tools";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function configure() {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key-not-a-real-credential");
  vi.stubEnv("RUNTIME_MODEL_ID", "gemini-2.5-flash-lite");
  vi.stubEnv("RUNTIME_INPUT_USD_PER_MILLION", "1");
  vi.stubEnv("RUNTIME_OUTPUT_USD_PER_MILLION", "2");
}
function providerResponse(parts: unknown[]) {
  return Response.json({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 } });
}
it("round-trips the Google tool-call protocol without automatically executing tools", async () => {
  configure();
  const fetch = vi.fn(async () => providerResponse([{ functionCall: { name: "knowledge_search", args: { query: "returns" } } }]));
  vi.stubGlobal("fetch", fetch);
  const driver = createGoogleDriver();
  const selected = [demoRegistry.get("knowledge_search")!];
  const turn = await driver.turn(supportAgent, [{ role: "user", content: "returns?" }], selected, new AbortController().signal);
  expect(turn.calls).toHaveLength(1);
  expect(turn.calls[0]).toMatchObject({ toolId: "knowledge_search", input: { query: "returns" } });
  expect(turn.inputTokens).toBe(12); expect(turn.outputTokens).toBe(6);
  const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
  const body = JSON.parse(request[1].body as string);
  expect(body.tools[0].functionDeclarations.map((tool: { name: string }) => tool.name)).toEqual(["knowledge_search"]);
  expect(body.generationConfig.maxOutputTokens).toBe(supportAgent.limits.maxOutputTokens);
  expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
});
it("does not retry billable provider failures", async () => {
  configure();
  const fetch = vi.fn(async () => Response.json({ error: { code: 503, message: "provider unavailable", status: "UNAVAILABLE" } }, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  await expect(createGoogleDriver().turn(supportAgent, [{ role: "user", content: "test" }], [], new AbortController().signal)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
});
it("uses Gemini 3.1 minimal thinking and accounts for reasoning in output usage", async () => {
  configure(); vi.stubEnv("RUNTIME_MODEL_ID", "gemini-3.1-flash-lite");
  const fetch = vi.fn(async () => Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, thoughtsTokenCount: 4, totalTokenCount: 22 },
  }));
  vi.stubGlobal("fetch", fetch);
  const result = await createGoogleDriver().turn(supportAgent, [{ role: "user", content: "test" }], [], new AbortController().signal);
  expect(result.outputTokens).toBe(10);
  const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(call[1].body as string).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal", includeThoughts: false });
});
it("generates a structured draft through the installed Google/AI SDK adapters", async () => {
  configure();
  const draft = { name: "Support", instructions: "Answer policy questions", model: "gemini", tools: [], assumptions: [], suggestedTests: [] };
  vi.stubGlobal("fetch", vi.fn(async () => providerResponse([{ text: JSON.stringify(draft) }])));
  const result = await googleDraftGenerator("Support agent", [], new AbortController().signal);
  expect(result.draft).toEqual(draft);
  expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 6, estimatedCostUsd: 0.000024 });
});
it("fails closed for missing model, credentials or pricing", () => {
  configure(); vi.stubEnv("RUNTIME_INPUT_USD_PER_MILLION", "");
  expect(() => createGoogleDriver()).toThrow();
  configure(); vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
  expect(() => createGoogleDriver()).toThrow("model_credentials_missing");
});
it("keeps partial provider usage unknown instead of treating absent token counts as zero", async () => {
  configure();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 12 },
  })));
  const result = await createGoogleDriver().turn(supportAgent, [{ role: "user", content: "test" }], [], new AbortController().signal);
  expect(result.inputTokens).toBe(12); expect(result.outputTokens).toBeNull();
});
