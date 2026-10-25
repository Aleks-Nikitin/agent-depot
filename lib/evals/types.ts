export type TestSource = "gemini" | "user" | "template";

export type TestCase = {
  id: string;
  input: string;
  mustCall: string[];
  mustNotCall: string[];
  mustContain: string[];
  /** Ask Gemini whether the answer followed policy. */
  useGrader: boolean;
  expectedBehavior?: string;
  source: TestSource;
};

export type TestCaseStatus = "pending" | "running" | "passed" | "failed" | "error";

export type TestResult = {
  testCaseId: string;
  status: "passed" | "failed" | "error";
  /** Human-readable, e.g. "Answer did not contain 'not in our policy'". */
  failures: string[];
  response: string | null;
  runId: string | null;
  durationMs: number | null;
  costUsd: number | null;
};

export type TestRunReport = {
  version: number;
  ranAt: string;
  durationMs: number | null;
  costUsd: number | null;
  results: TestResult[];
};

export type QualitySummary = {
  previousVersion: number | null;
  previousPassRate: number | null;
  toolErrors: number;
  mostCommonFailure: string | null;
};
