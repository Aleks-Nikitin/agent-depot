import type { QualitySummary, TestCase, TestResult, TestRunReport } from "@/lib/evals/types";
import { FIXTURE_NOW } from "./runs";

// FIXTURE DATA: the five AcmeStore test cases and a 4/5 report for v3, matching the design.
// PLACEHOLDER(P8): load from TestCase / TestRun tables once Dev 1 adds them.

export const fixtureTestCases: TestCase[] = [
  { id: "t1", input: "Can I return a jacket after 20 days?", mustCall: ["knowledge_search"], mustNotCall: ["send_email"], mustContain: ["30 days"], useGrader: false, source: "gemini" },
  { id: "t2", input: "How long does shipping take?", mustCall: ["knowledge_search"], mustNotCall: [], mustContain: ["business days"], useGrader: false, source: "gemini" },
  { id: "t3", input: "Do you price match other stores?", mustCall: ["knowledge_search"], mustNotCall: [], mustContain: ["not in our policy"], useGrader: true, source: "user" },
  { id: "t4", input: "Refund order 1042", mustCall: ["send_email"], mustNotCall: [], mustContain: [], useGrader: false, source: "template" },
  { id: "t5", input: "What's your phone number?", mustCall: [], mustNotCall: ["send_email"], mustContain: ["support"], useGrader: false, source: "gemini" },
];

const ok = (testCaseId: string, durationMs: number, costUsd: number) =>
  ({ testCaseId, status: "passed" as const, failures: [], response: null, runId: null, durationMs, costUsd });

export const fixtureTestReport: TestRunReport = {
  version: 3,
  ranAt: new Date(FIXTURE_NOW - 40_000).toISOString(),
  durationMs: 11_200,
  costUsd: 0.009,
  results: [
    ok("t1", 1800, 0.0012),
    ok("t2", 2100, 0.0011),
    { testCaseId: "t3", status: "failed", runId: "run-126", durationMs: 3400, costUsd: 0.0029,
      failures: ["Answer did not contain 'not in our policy'", "Grader: the agent invented a price-match guarantee that isn't in the docs"],
      response: "Yes! We match any competitor's price within 14 days of purchase." },
    ok("t4", 2300, 0.0021),
    ok("t5", 1600, 0.0017),
  ],
};

export const fixtureQuality: QualitySummary = {
  previousVersion: 2, previousPassRate: 1, toolErrors: 0, mostCommonFailure: "Invented information (hallucination)",
};

/**
 * Replays the fixture report one case at a time, so the Tests tab shows running → pass/fail.
 * Cases with no fixture result report "error", never a fake pass.
 * PLACEHOLDER(P8/P9): replace with POST /api/agents/[id]/tests/run (lib/evals/runner.ts on the server).
 */
export async function simulateTestRun(version: number, cases: TestCase[],
  onUpdate: (u: TestResult | { testCaseId: string; status: "running" }) => void,
  { delayMs = 450, signal }: { delayMs?: number; signal?: AbortSignal } = {}): Promise<TestRunReport> {
  const started = Date.now();
  const results: TestResult[] = [];
  for (const c of cases) {
    if (signal?.aborted) break;
    onUpdate({ testCaseId: c.id, status: "running" });
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    const r = fixtureTestReport.results.find(x => x.testCaseId === c.id) ?? {
      testCaseId: c.id, status: "error" as const, response: null, runId: null, durationMs: null, costUsd: null,
      failures: ["Not evaluated: fixture mode has no result for new cases until the test runner is connected"],
    };
    results.push(r);
    onUpdate(r);
  }
  const costs = results.map(r => r.costUsd);
  return {
    version, ranAt: new Date().toISOString(), durationMs: Date.now() - started,
    costUsd: costs.every(c => c != null) ? costs.reduce<number>((a, b) => a + (b ?? 0), 0) : null, results,
  };
}
