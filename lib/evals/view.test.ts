import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { StateDiff } from "@/components/tests/state-diff";
import { TestStatusPill } from "@/components/tests/test-case-card";
import { stateEvidence } from "./state/evidence";
import { evaluationOutcome } from "./outcome";

vi.stubGlobal("React", React);
it("renders failed assertions, exact added/removed/changed state, and availability labels accessibly", () => {
  const ticket = { id: "existing", ownerId: "owner", subject: "Original", idempotencyKey: "key" };
  const evidence = stateEvidence({ ownerId: "owner", manifestHash: "fixture", test: { id: "case", mustCall: [] }, runId: "run", sourceCompleted: true,
    before: { tickets: [ticket, { ...ticket, id: "removed" }], orders: [], knowledge: [] },
    after: { tickets: [{ ...ticket, subject: "<script>changed</script>" }, { ...ticket, id: "added" }], orders: [], knowledge: [] } });
  const html = renderToStaticMarkup(React.createElement(StateDiff, { evidence }));
  expect(html).toContain("State checks failed"); expect(html).toContain("1 added · 1 removed · 1 changed");
  expect(html).toContain("Original"); expect(html).toContain("&lt;script&gt;changed&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain("No database changes"); expect(html).toContain("Database assertions");
  for (const [outcome, label] of [["provider_unavailable", "Provider unavailable"], ["grader_unavailable", "Grader unavailable"], ["behavior_failure", "Behavior failed"], ["pass", "Passed"]] as const) {
    expect(renderToStaticMarkup(React.createElement(TestStatusPill, { status: outcome === "pass" ? "passed" : "error", result: {
      outcome, status: outcome === "pass" ? "passed" : "error", testCaseId: "case", failures: [], response: null, runId: null, costUsd: null, durationMs: null,
    } }))).toContain(label);
  }
  expect(evaluationOutcome({ status: "error" })).toBe("evaluation_unavailable");
});
