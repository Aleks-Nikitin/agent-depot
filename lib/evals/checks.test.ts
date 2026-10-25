import { describe, expect, it } from "vitest";
import { RunStepSchema, type RunStep } from "@/lib/agents/contracts";
import { buildScenario } from "@/lib/fixtures/scenarios";
import { checkTestCase } from "./checks";
import type { TestCase } from "./types";

const testCase = (overrides: Partial<TestCase>): TestCase => ({
  id: "t1", input: "question", mustCall: [], mustNotCall: [], mustContain: [], useGrader: false, source: "user", ...overrides,
});

/** Contract-valid events with sequential ids, like the runtime fixtures. */
function events(...steps: Array<[RunStep["type"], unknown]>): RunStep[] {
  return steps.map(([type, payload], i) => RunStepSchema.parse({ schemaVersion: 1, eventId: `e${i + 1}`, runId: "run-x",
    sequence: i + 1, timestamp: new Date(Date.UTC(2026, 9, 24, 18, 0, i)).toISOString(), type, payload }));
}
const usage = { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.0001 };
const write = { toolCallId: "w1", toolId: "send_email", input: { to: "a@example.com" } };

/** What a test run (approvals auto-denied) records when the agent tries a write tool. */
const deniedWrite = (response: string) => events(
  ["run_started", { agentId: "a" }], ["model_started", { step: 1 }], ["model_finished", usage],
  ["tool_requested", write], ["tool_failed", { toolCallId: "w1", toolId: "send_email", reason: "write_denied" }],
  ["model_started", { step: 2 }], ["model_finished", usage],
  ["run_completed", { response, durationMs: 100, usage }]);

describe("checkTestCase", () => {
  const returns = buildScenario("returnPolicy");
  const run = { steps: returns.events, response: "Yes. AcmeStore accepts returns within 30 days of delivery." };

  it("passes when every check holds", () => {
    const r = checkTestCase(testCase({ mustCall: ["knowledge_search"], mustNotCall: ["send_email"], mustContain: ["30 days"] }), run);
    expect(r).toMatchObject({ testCaseId: "t1", status: "passed", failures: [], response: run.response, runId: "fixture-returnPolicy" });
    expect(r.durationMs).toBe(2100);
    expect(r.costUsd).toBe(0.0012);
  });

  it("fails when a required tool was never called", () => {
    const r = checkTestCase(testCase({ mustCall: ["knowledge_search", "sales_lookup"] }), run);
    expect(r.status).toBe("failed");
    expect(r.failures).toEqual(["did not call sales_lookup"]);
  });

  it("counts a required write tool that was only auto-denied as called", () => {
    const r = checkTestCase(testCase({ mustCall: ["send_email"] }), { steps: deniedWrite("Not sent."), response: "Not sent." });
    expect(r).toMatchObject({ status: "passed", failures: [] });
  });

  it("counts a required tool seen only in an approval_required step as called", () => {
    const paused = buildScenario("refundApproval").events.filter(e => !(e.type.startsWith("tool_") && "toolId" in e.payload && e.payload.toolId === "send_email"));
    expect(paused.some(e => e.type === "approval_required")).toBe(true);
    const r = checkTestCase(testCase({ mustCall: ["send_email"] }), { steps: paused, response: null });
    expect(r.failures).toEqual([]);
  });

  it("fails when a forbidden tool was called", () => {
    const r = checkTestCase(testCase({ mustNotCall: ["knowledge_search"] }), run);
    expect(r.failures).toEqual(["called forbidden tool knowledge_search"]);
  });

  it("fails when a forbidden write tool was only attempted and auto-denied", () => {
    const r = checkTestCase(testCase({ mustNotCall: ["send_email"] }), { steps: deniedWrite("Not sent."), response: "Not sent." });
    expect(r).toMatchObject({ status: "failed", failures: ["called forbidden tool send_email"] });
  });

  it("fails when the answer is missing a required phrase", () => {
    const r = checkTestCase(testCase({ mustContain: ["30 days", "not in our policy"] }), run);
    expect(r.failures).toEqual(['answer did not contain "not in our policy"']);
  });

  it("matches required phrases case-insensitively and ignores surrounding spaces", () => {
    const r = checkTestCase(testCase({ mustContain: ["  ACMESTORE accepts RETURNS  "] }), run);
    expect(r.status).toBe("passed");
  });

  it("reports a blocked run and still evaluates the other checks", () => {
    const blocked = buildScenario("stepLimit");
    const r = checkTestCase(testCase({ mustCall: ["knowledge_search", "sales_lookup"], mustContain: ["returns"] }), { steps: blocked.events, response: null });
    expect(r.status).toBe("failed");
    expect(r.failures).toEqual(["run ended with step_limit", "did not call sales_lookup", 'answer did not contain "returns"']);
  });

  it("reports a failed run's reason", () => {
    const r = checkTestCase(testCase({}), { steps: buildScenario("providerFailure").events, response: null });
    expect(r.failures).toEqual(["run ended with execution_failed"]);
    expect(r.costUsd).toBeNull();
  });
});
