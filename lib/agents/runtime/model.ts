import { generateText, tool, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { AgentConfig } from "../contracts";
import type { ToolDefinition } from "../tools/registry";
import type { PendingCall } from "./state";

export type ModelTurn = {
  text: string; calls: PendingCall[]; messages: ModelMessage[];
  inputTokens: number | null; outputTokens: number | null;
};
export interface ModelDriver {
  key: string;
  estimate(inputTokens: number, outputTokens: number): number;
  turn(config: AgentConfig, messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal): Promise<ModelTurn>;
}
export function createGoogleDriver(): ModelDriver {
  const modelId = z.string().startsWith("gemini-").parse(process.env.RUNTIME_MODEL_ID);
  const rates = z.object({ input: z.coerce.number().positive(), output: z.coerce.number().positive() }).parse({
    input: process.env.RUNTIME_INPUT_USD_PER_MILLION, output: process.env.RUNTIME_OUTPUT_USD_PER_MILLION,
  });
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("model_credentials_missing");
  return {
    key: `${modelId}:${rates.input}:${rates.output}:text-no-thinking-v1`,
    estimate: (input, output) => (input * rates.input + output * rates.output) / 1_000_000,
    async turn(config, messages, tools, signal) {
      const result = await generateText({
        model: google(modelId), instructions: config.instructions, messages,
        tools: Object.fromEntries(tools.map(t => [t.id, tool({ description: t.description, inputSchema: t.inputSchema })])),
        maxOutputTokens: config.limits.maxOutputTokens, maxRetries: 0, abortSignal: signal,
        // Initial supported profile: text-only models that accept disabled thinking.
        // If the configured model rejects this option the run fails safely.
        providerOptions: { google: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } },
      });
      return { text: result.text,
        calls: result.toolCalls.map(c => ({ toolCallId: c.toolCallId, toolId: c.toolName, input: c.input })),
        messages: result.response.messages,
        inputTokens: result.usage.inputTokens ?? null, outputTokens: result.usage.outputTokens ?? null,
      };
    },
  };
}
