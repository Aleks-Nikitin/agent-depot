import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RoutingPanel } from "@/components/routing/routing-panel";
import { BenchmarkPanel } from "@/components/routing/benchmark-panel";
import { summarize } from "./report";
vi.stubGlobal("React", React);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
it("shows an explicit opt-in and paid, isolated comparison boundary", () => {
  const html = renderToStaticMarkup(React.createElement(RoutingPanel, { initial: { agentId: "agent", version: 1, routing: null,
    primaryProfile: "gemini-primary", decision: null, reason: null, catalog: {}, benchmarks: [] } }));
  expect(html).toContain("Original model selection"); expect(html).toContain("Save routing as new draft");
  expect(html).toContain("Normal provider costs apply"); expect(html).toContain("never authorize publication");
});
it("shows unknown cost and incomplete trials without announcing savings or passing evidence", () => {
  const html = renderToStaticMarkup(React.createElement(BenchmarkPanel, { initial: { id: "benchmark", agentId: "agent", version: 2, status: "failed", reason: "unavailable",
    repeats: 2, workloadHash: "workload", baseManifestHash: "manifest", policy: { version: 1, mode: "locked", lockedProfile: "gemini-primary", approvedProfiles: ["gemini-primary"], minContextTokens: 8192,
      allowedProviders: ["google"], dataPolicyTag: "test", maxExpectedLatencyMs: 10000, maxCostTier: "standard" }, cases: [{ id: "case", input: "<script>untrusted</script>" }],
    arms: [{ arm: "primary", ...summarize([], 2, []) }, { arm: "routed", ...summarize([], 2, []) }], children: [], previous: [], comparison: null,
    notice: "Descriptive results only", } }));
  expect(html).toContain("Unknown"); expect(html).toContain("0 / 2"); expect(html).toContain("Unavailable or not observed");
  expect(html).toContain("Cost per successful task"); expect(html).not.toContain("Promote");
});
