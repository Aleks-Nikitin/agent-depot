import { APICallError } from "ai";

/** Stable public reasons only. Never persist provider bodies, URLs or exception messages. */
export function modelFailureReason(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) return "model_access_denied";
    if (status === 429) return "model_rate_limited";
    if (status === 404) return "model_not_found";
    if (status === 400 || status === 422) return "model_request_rejected";
    if (status && status >= 500) return "model_unavailable";
    return "model_connection_failed";
  }
  if (error instanceof Error && /fetch|network|connect|socket/i.test(error.name + " " + error.message)) return "model_connection_failed";
  return "model_response_invalid";
}
export const toolFailureCodes = new Set([
  "ticket_not_found", "idempotency_conflict", "search_not_configured", "search_rate_limited", "search_access_denied", "search_unavailable", "search_response_invalid",
  "webpage_unavailable", "email_removed",
]);
export function toolFailureReason(error: unknown): string {
  return error instanceof Error && toolFailureCodes.has(error.message) ? error.message : "tool_execution_failed";
}
