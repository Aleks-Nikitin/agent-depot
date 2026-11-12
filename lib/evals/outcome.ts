import type { EvaluationOutcome, TestResult } from "./types";

export const OUTCOME_LABELS: Record<EvaluationOutcome, string> = {
  pass: "Passed", behavior_failure: "Behavior failed", provider_unavailable: "Provider unavailable",
  grader_unavailable: "Grader unavailable", evaluation_unavailable: "Evaluation unavailable",
};

/** Old reports have no reliable availability cause; never guess a provider outage from text. */
export function evaluationOutcome(result: Pick<TestResult, "status" | "outcome">): EvaluationOutcome {
  return result.outcome ?? (result.status === "passed" ? "pass" : result.status === "failed" ? "behavior_failure" : "evaluation_unavailable");
}

export const PROVIDER_FAILURES = new Set([
  "model_unavailable", "model_rate_limited", "model_connection_failed", "model_access_denied",
  "model_not_found", "model_request_rejected", "model_credentials_missing", "model_response_invalid",
]);
