import { AsyncLocalStorage } from "node:async_hooks";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage } from "@langchain/core/messages";
import type { AgentConfig } from "../contracts";
import { z } from "zod";
import { ModelProfileIdSchema, modelProfileId, resolveProfile, type ModelProfileId } from "../profiles";
import { googleThinkingConfig, type ModelDriver, type ModelTurn } from "./model";

// Preserve raw billing fields: the SDK otherwise fills missing counts with zero
// and does not include Gemini thinking tokens in its output count.
class BoundedGoogleModel extends ChatGoogleGenerativeAI {
  private requestOptions = new AsyncLocalStorage<Parameters<ChatGoogleGenerativeAI["_generate"]>[1]>();
  override _generate(...args: Parameters<ChatGoogleGenerativeAI["_generate"]>) {
    return this.requestOptions.run(args[1], () => super._generate(...args));
  }
  override async completionWithRetry(...args: Parameters<ChatGoogleGenerativeAI["completionWithRetry"]>) {
    const result = await super.completionWithRetry(args[0], args[1] ?? this.requestOptions.getStore());
    const usage = result.response.usageMetadata;
    const candidate = result.response.candidates?.[0];
    if (candidate) Object.assign(candidate, { runtimeUsage: {
      inputTokens: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : null,
      outputTokens: typeof usage?.candidatesTokenCount === "number"
        ? usage.candidatesTokenCount + ((usage as { thoughtsTokenCount?: number }).thoughtsTokenCount ?? 0) : null,
    } });
    return result;
  }
}
function nativeProfileDriver(config: AgentConfig, id: ModelProfileId): ModelDriver {
  const profile = resolveProfile(id);
  const chatModel = profile.provider === "google"
    ? new BoundedGoogleModel({ model: profile.model, apiKey: profile.apiKey,
      maxOutputTokens: config.limits.maxOutputTokens, maxRetries: 0,
      // The installed Google SDK type predates Gemini 3.1's minimal level;
      // preserve the configured API value rather than substituting LOW.
      thinkingConfig: googleThinkingConfig(profile.model) as ChatGoogleGenerativeAI["thinkingConfig"],
    })
    : new ChatOpenAI({ model: profile.model, apiKey: profile.apiKey,
      maxTokens: config.limits.maxOutputTokens, maxRetries: 0 });
  return {
    key: `${profile.id}:${profile.model}:${profile.rates.input}:${profile.rates.output}:langchain-v1`,
    chatModel, identity: { profile: profile.id, provider: profile.provider, model: profile.model },
    estimate: (input, output) => (input * profile.rates.input + output * profile.rates.output) / 1_000_000,
    async turn() { throw new Error("native_model_requires_graph"); },
  };
}
export function createProfileDriver(config: AgentConfig): ModelDriver {
  const id = modelProfileId(config);
  const primary = nativeProfileDriver(config, id);
  const selected = config.fallbackModelProfile ?? process.env.RUNTIME_FALLBACK_PROFILE;
  const fallbackId = selected ? ModelProfileIdSchema.parse(selected) : undefined;
  if (fallbackId === id) throw new Error("invalid_fallback_profile");
  const fallback = fallbackId ? nativeProfileDriver(config, fallbackId) : undefined;
  const maxRetries = z.coerce.number().int().min(0).max(2).parse(process.env.RUNTIME_MODEL_MAX_RETRIES ?? "1");
  primary.recovery = { maxRetries, fallback };
  primary.key += `:recovery-v1:${maxRetries}:${fallback?.key ?? "none"}`;
  return primary;
}
export function nativeModelTurn(message: AIMessage): ModelTurn {
  const raw = message.response_metadata.runtimeUsage ?? message.additional_kwargs.runtimeUsage;
  const usage = raw as { inputTokens: number | null; outputTokens: number | null } | undefined;
  const reason = String(message.response_metadata.finishReason ?? message.response_metadata.finish_reason ?? "");
  const finishReason = ({ STOP: "stop", stop: "stop", tool_calls: "tool-calls", MAX_TOKENS: "length", length: "length",
    SAFETY: "content-filter", RECITATION: "content-filter", content_filter: "content-filter" } as Record<string, string>)[reason] ?? "other";
  const text = typeof message.content === "string" ? message.content : message.content
    .filter(b => b.type === "text" && !("thought" in b && b.thought))
    .map(b => "text" in b ? b.text : "").join("");
  const calls = (message.tool_calls ?? []).map(c => ({ toolCallId: c.id!, toolId: c.name, input: c.args }));
  if (message.invalid_tool_calls?.length || calls.some(c => !c.toolCallId)) throw new Error("invalid_model_tool_call");
  return { text, calls, finishReason,
    inputTokens: usage ? usage.inputTokens : message.usage_metadata?.input_tokens ?? null,
    outputTokens: usage ? usage.outputTokens : message.usage_metadata?.output_tokens ?? null,
    messages: [{ role: "assistant", content: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...calls.map(c => ({ type: "tool-call" as const, toolCallId: c.toolCallId, toolName: c.toolId, input: c.input })),
    ] }],
  };
}
