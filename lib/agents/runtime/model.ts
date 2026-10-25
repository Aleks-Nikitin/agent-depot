import { generateText, tool, type ModelMessage, type LanguageModelUsage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { AgentConfig } from "../contracts";
import type { ToolDefinition } from "../tools/registry";
import type { PendingCall } from "./state";

export type ModelTurn = {
  text: string; calls: PendingCall[]; messages: ModelMessage[];
  inputTokens: number | null; outputTokens: number | null;
  finishReason?: string;
};
export interface ModelDriver {
  key: string;
  estimate(inputTokens: number, outputTokens: number): number;
  turn(config: AgentConfig, messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal): Promise<ModelTurn>;
}
export function googleUsage(usage: LanguageModelUsage) {
  // The provider adapter normalizes missing individual fields to zero. Preserve
  // "unknown" when billing metadata was partial rather than accepting free use.
  const raw = usage.raw;
  return {
    inputTokens: typeof raw?.promptTokenCount === "number" ? usage.inputTokens ?? null : null,
    outputTokens: typeof raw?.candidatesTokenCount === "number" ? usage.outputTokens ?? null : null,
  };
}
export function googleThinkingConfig(modelId: string) {
  if (modelId === "gemini-3.1-flash-lite") return { thinkingLevel: "minimal" as const, includeThoughts: false };
  if (["gemini-2.5-flash-lite", "gemini-2.5-flash"].includes(modelId)) return { thinkingBudget: 0, includeThoughts: false };
  throw new Error("unsupported_model_profile");
}
export function createGoogleDriver(): ModelDriver {
  const modelId = z.string().startsWith("gemini-").parse(process.env.RUNTIME_MODEL_ID);
  const thinkingConfig = googleThinkingConfig(modelId);
  const rates = z.object({ input: z.coerce.number().positive(), output: z.coerce.number().positive() }).parse({
    input: process.env.RUNTIME_INPUT_USD_PER_MILLION, output: process.env.RUNTIME_OUTPUT_USD_PER_MILLION,
  });
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("model_credentials_missing");
  return {
    key: `${modelId}:${rates.input}:${rates.output}:text-bounded-thinking-v2`,
    estimate: (input, output) => (input * rates.input + output * rates.output) / 1_000_000,
    async turn(config, messages, tools, signal) {
      const result = await generateText({
        model: google(modelId), instructions: config.instructions, messages,
        tools: Object.fromEntries(tools.map(t => [t.id, tool({ description: t.description, inputSchema: t.inputSchema })])),
        maxOutputTokens: config.limits.maxOutputTokens, maxRetries: 0, abortSignal: signal,
        // Minimal thinking for Gemini 3.1, disabled for supported 2.5 models.
        // The SDK's output usage includes both text and reasoning tokens.
        providerOptions: { google: { thinkingConfig } },
      });
      return { text: result.text,
        calls: result.toolCalls.map(c => ({ toolCallId: c.toolCallId, toolId: c.toolName, input: c.input })),
        messages: result.response.messages, finishReason: result.finishReason,
        ...googleUsage(result.usage),
      };
    },
  };
}
