import { expect, it } from "vitest";
import { summarize } from "./report";
import type { TestResult } from "@/lib/evals/types";
const result = (overrides: Partial<TestResult> = {}): TestResult => ({ testCaseId: "case", status: "passed", outcome: "pass", failures: [], response: "ok", runId: null, durationMs: 100, costUsd: .01, ...overrides });
it("includes failed and missing trials in the denominator and preserves unknown cost rather than inventing savings", () => {
  const summary = summarize([result(), result({ status: "error", outcome: "provider_unavailable", costUsd: null, durationMs: 900 })], 3,
    [{ estimatedCostUsd: .01, reservedCostUsd: .02 }, { estimatedCostUsd: null, reservedCostUsd: .03 }]);
  expect(summary).toMatchObject({ expected: 3, observed: 2, passed: 1, unavailable: 2, passRate: 1 / 3, costUsd: null, costPerSuccessUsd: null,
    knownCostLowerBoundUsd: .01, attempts: 2, unknownAttempts: 1, p50Ms: 100, p95Ms: 900, latencyObservations: 2 });
  expect(summarize([result(), result({ status: "failed", outcome: "behavior_failure", costUsd: .02 })], 2, []).costPerSuccessUsd).toBe(.03);
});
