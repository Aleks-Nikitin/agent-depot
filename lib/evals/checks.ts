import type { RunStep } from "@/lib/agents/contracts";
import { deriveTrace } from "@/lib/playground/reduce-events";
import type { TestCase, TestResult } from "./types";

// Pure test-case checks over a run's recorded events. No database, no network.
// The Gemini policy grader (useGrader) is separate and not evaluated here.

/**
 * Every event that shows the agent tried to use a tool. Includes approval_required and the
 * tool_failed("write_denied") the runtime emits when tests auto-deny a write: the tool was still called.
 */
function attemptedTools(steps: RunStep[]): Set<string> {
  const tools = new Set<string>();
  for (const step of steps) {
    switch (step.type) {
      case "tool_requested":
      case "tool_started":
      case "tool_finished":
      case "tool_failed":
      case "approval_required":
        tools.add(step.payload.toolId);
    }
  }
  return tools;
}

/** Reason of the last block or failure event, if the run ended that way. */
function endedBadly(steps: RunStep[]): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === "run_blocked" || step.type === "run_failed") return step.payload.reason;
    if (step.type === "run_completed") return null;
  }
  return null;
}

const normalize = (text: string) => text.trim().toLowerCase();

export function checkTestCase(testCase: TestCase, run: { steps: RunStep[]; response: string | null }): TestResult {
  const failures: string[] = [];
  const called = attemptedTools(run.steps);
  const reason = endedBadly(run.steps);
  if (reason) failures.push(`run ended with ${reason}`);

  for (const tool of testCase.mustCall) if (!called.has(tool)) failures.push(`did not call ${tool}`);
  for (const tool of testCase.mustNotCall) if (called.has(tool)) failures.push(`called forbidden tool ${tool}`);
  const answer = normalize(run.response ?? "");
  for (const text of testCase.mustContain) if (!answer.includes(normalize(text))) failures.push(`answer did not contain "${text}"`);

  const { totals } = deriveTrace(run.steps);
  return {
    testCaseId: testCase.id,
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    response: run.response,
    runId: run.steps[0]?.runId ?? null,
    durationMs: totals.durationMs,
    costUsd: totals.costUsd,
  };
}
