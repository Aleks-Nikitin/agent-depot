import type { z } from "zod";
import type { RunStatusSchema } from "@/lib/agents/contracts";

// Display formatting. Unknown (null) values render as "unknown", never as zero.

export type ContractRunStatus = z.infer<typeof RunStatusSchema>;

/**
 * What the UI shows. Extends the runtime's statuses with two display-only states:
 * - rejected: the run ended after a human rejected a write (runtime records it as completed).
 * - interrupted: the stream ended with no terminal event; never treat that as success.
 */
export type RunStatus = ContractRunStatus | "rejected" | "interrupted";

export const finishedStatuses: readonly RunStatus[] = ["completed", "rejected", "blocked", "failed", "interrupted"];
export const isFinished = (s: RunStatus) => finishedStatuses.includes(s);

export const UNKNOWN = "unknown";

/** "#127" for fixture/numbered runs, otherwise a short id. PLACEHOLDER(P12). */
export function runLabel(runId: string | null, number?: number | null): string {
  if (number != null) return `#${number}`;
  if (!runId) return "—";
  const n = runId.match(/^run-(\d+)$/)?.[1];
  return n ? `#${n}` : `#${runId.slice(-6)}`;
}

/** "v2", or "—" when the version is unknown. */
export const formatVersion = (version: number | null | undefined) => (version == null ? "—" : `v${version}`);

export function formatClock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

export function formatTokens(tokens: number | null | undefined): string {
  return tokens == null ? UNKNOWN : `${Math.round(tokens).toLocaleString("en-US")} tok`;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return UNKNOWN;
  return `$${usd.toFixed(usd >= 0.1 ? 2 : 4)}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return UNKNOWN;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 30) return "just now";
  if (seconds < 90) return "1 min ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Stop reasons from the runtime, in plain words. Unknown codes fall back to the code itself. */
const reasons: Record<string, string> = {
  runtime_unavailable: "The server could not start the agent. Ask the administrator to check Gemini configuration and the database; your request has not been confirmed",
  unauthorized: "Your session has ended. Sign in or continue as guest before running this agent",
  forbidden: "This action is not allowed in your workspace. Check that you are signed in to the right account",
  not_found: "This agent or run is not available in your workspace. Open your agent list and choose an existing agent",
  approval_unavailable: "This review has expired or was already decided. Reload the saved run to see its latest state",
  run_unavailable: "This run is no longer active. Reload its history before starting another request",
  invalid_body: "The request was invalid. Check your message and try again",
  write_limit: "Write-action limit reached",
  ticket_not_found: "The support ticket does not exist in this workspace",
  step_limit: "Step limit reached", tool_limit: "Tool-call limit reached", budget_limit: "Cost cap reached",
  usage_unknown: "Provider did not report usage", context_limit: "Context too large", output_limit: "Output limit reached",
  model_policy_changed: "Model or pricing changed while paused", interrupted_or_timeout: "Run timed out or was interrupted",
  model_access_denied: "Gemini rejected the API key or this model's permissions. Ask the workspace administrator to check Gemini access",
  model_rate_limited: "Gemini's request or usage quota was reached. Wait and try again, or ask the administrator to check the quota",
  model_not_found: "The configured Gemini model is unavailable. Ask the administrator to check the model setting",
  model_request_rejected: "Gemini rejected this agent's request or tool definitions. Edit the agent or ask the administrator to check its configuration",
  model_unavailable: "Gemini is temporarily unavailable. Try again later",
  model_connection_failed: "The app could not reach Gemini. Check the server's internet connection and try again",
  model_response_invalid: "Gemini returned a response the app could not use. Try again; if it repeats, ask the administrator to check the agent",
  tool_execution_failed: "A tool could not complete its action. Open the failed step in the trace for details; success has not been confirmed",
  search_not_configured: "Live search is not connected. Ask the administrator to configure SERPAPI_API_KEY in the server environment",
  search_rate_limited: "The search provider's quota was reached. Wait or ask the administrator to check SerpApi usage",
  search_access_denied: "The search provider rejected its credentials. Ask the administrator to check SerpApi access",
  search_unavailable: "The search service could not be reached. Try again later",
  search_response_invalid: "The search service returned an unsupported response. No reliable results are available",
  webpage_unavailable: "This webpage could not be read. Try a different public page",
  email_removed: "Email delivery is not supported. Edit this agent, remove send_email, and use internal support tickets instead",
  invalid_tool_input: "The agent supplied invalid tool arguments. Try a clearer request or edit the agent instructions",
  model_content_filtered: "Gemini blocked this response under its safety policy. Rephrase the request",
  model_incomplete: "Gemini could not finish a valid response. Try a simpler request",
  empty_response: "Gemini returned no answer. Try a more specific request",
  execution_failed: "This run stopped unexpectedly. No specific cause was recorded. Try a new run; if it repeats, share its run ID with the administrator", provider_failure: "Model provider failed", event_delivery_failed: "Event delivery failed",
  write_denied: "Write denied by the run policy", stream_ended: "Connection ended before the run finished",
};
export const describeReason = (code: string) => reasons[code] ?? code;
