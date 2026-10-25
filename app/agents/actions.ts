"use server";

import { draftAgent, googleDraftGenerator } from "@/lib/agents/runtime/draft";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { AgentDraft } from "@/lib/agents/contracts";
import { pageOwner } from "@/lib/auth/session";

export type DraftResult =
  | { ok: true; draft: AgentDraft }
  | { ok: false; error: string };

// Runs server-side so the Gemini key never reaches the browser. Fills the
// builder form from a plain-language goal.
export async function draftAgentAction(goal: string): Promise<DraftResult> {
  await pageOwner();
  const trimmed = goal.trim();
  if (!trimmed) return { ok: false, error: "Describe what the agent should do." };
  try {
    const signal = AbortSignal.timeout(30_000);
    const { draft } = await draftAgent(trimmed, runtimeRegistry, googleDraftGenerator, signal);
    return { ok: true, draft };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "draft_failed";
    const message =
      reason === "draft_budget_limit"
        ? "Goal is too long to draft within budget. Shorten it."
        : reason.includes("API key") || reason.includes("GENERATIVE")
          ? "Gemini is not configured (missing GOOGLE_GENERATIVE_AI_API_KEY)."
          : "Could not draft the agent. Try again or fill the form manually.";
    return { ok: false, error: message };
  }
}
