import { afterEach, expect, it, vi } from "vitest";
import { traceRepairMetadata } from "@/lib/agents/runtime/tracing";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("exports only allowlisted repair metadata and ignores tracing transport failures", async () => {
  vi.stubEnv("LANGCHAIN_TRACING_V2", "true"); vi.stubEnv("LANGSMITH_API_KEY", "fixture-only");
  const fetch = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal("fetch", fetch);
  await traceRepairMetadata("case", "review", "child", null, 1, Date.now());
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.inputs).toEqual({}); expect(body.outputs).toEqual({});
  expect(body.extra.metadata).toEqual({ caseId: "case", graphVersion: 1, node: "interrupt_for_human_review", status: "review", childJobId: "child", appliedVersion: null, suiteCount: 1 });
  fetch.mockRejectedValue(new Error("unavailable"));
  await expect(traceRepairMetadata("case", "verified", "child", 3, 2, Date.now())).resolves.toBeUndefined();
});
