import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RepairPanel } from "@/components/repairs/repair-panel";
import type { repairView } from "./service";
vi.stubGlobal("React", React);
const initial: Awaited<ReturnType<typeof repairView>> = {
  id: "case", agentId: "agent", sourceRunId: "run", testCaseId: "test", status: "review", reason: null,
  baseVersion: 2, appliedVersion: null, proposalHash: "hash", expiresAt: "2027-01-01T00:00:00.000Z", expired: false, repeats: 2,
  before: "Original instructions", after: "Original instructions\n<script>untrusted requirement</script>", approved: null, baseline: null, child: null, evaluations: [],
};
it("escapes reviewed text and shows the exact approval boundary and bounded evaluation costs", () => {
  const html = renderToStaticMarkup(React.createElement(RepairPanel, { initial }));
  expect(html).toContain("Original instructions"); expect(html).toContain("&lt;script&gt;untrusted requirement&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain("Approve new draft and retest"); expect(html).toContain("Reject proposal"); expect(html).toContain("2 time(s)");
  expect(html).toContain("No completed retest evidence yet"); expect(html).not.toContain("The retest passed");
});
it("keeps an applied draft distinct from verification and displays unavailable retest evidence", () => {
  const result = { testCaseId: "test", status: "error", outcome: "provider_unavailable", failures: ["Provider unavailable"], response: null, runId: "new-run", durationMs: 10, costUsd: null };
  const html = renderToStaticMarkup(React.createElement(RepairPanel, { initial: { ...initial, status: "failed", appliedVersion: 3, approved: true,
    reason: "repair_retest_not_verified", child: { status: "completed", result: { version: 3, results: [result] } } } }));
  expect(html).toContain("Applied as Draft v3"); expect(html).toContain("Provider unavailable"); expect(html).toContain("No prior result");
  expect(html).not.toContain("The retest passed"); expect(html).not.toContain("Approve new draft and retest");
});
