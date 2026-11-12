import { APICallError } from "ai";

/** Stable public reasons only. Never persist provider bodies, URLs or exception messages. */
export function modelFailureReason(error: unknown): string {
  const nativeStatus = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : undefined;
  if (APICallError.isInstance(error) || nativeStatus !== undefined) {
    const status = APICallError.isInstance(error) ? error.statusCode : nativeStatus;
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
  "connector_not_connected", "connector_scope_changed", "connector_access_denied", "connector_rate_limited", "connector_request_failed", "connector_outcome_unknown", "connector_response_invalid", "connector_credential_unavailable",
  "workspace_tool_denied", "workspace_limit_exceeded", "guest_execution_disabled",
  "evaluation_scope_unavailable", "evaluation_external_tool_disabled", "domain_owner_mismatch", "domain_scope_required",
  "ticket_not_found", "idempotency_conflict", "search_not_configured", "search_rate_limited", "search_access_denied", "search_unavailable", "search_response_invalid",
  "webpage_unavailable", "email_removed",
]);
export function toolFailureReason(error: unknown): string {
  return error instanceof Error && toolFailureCodes.has(error.message) ? error.message : "tool_execution_failed";
}
