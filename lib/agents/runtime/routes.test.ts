import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supportAgent } from "../fixtures";

const mocks = vi.hoisted(() => ({ loadAgent: vi.fn(), services: vi.fn(), run: vi.fn(), resume: vi.fn(), draft: vi.fn(), claim: vi.fn(), enqueueRun: vi.fn(), enqueueApproval: vi.fn() }));
vi.mock("./services", () => ({ loadAgent: mocks.loadAgent, runtimeServices: mocks.services }));
vi.mock("./run-agent", () => ({ runAgent: mocks.run, resumeClaimedRun: mocks.resume }));
vi.mock("./draft", async importOriginal => ({ ...(await importOriginal<typeof import("./draft")>()), draftAgent: mocks.draft }));
vi.mock("@/lib/jobs/queue", () => ({ enqueueRun: mocks.enqueueRun, enqueueApproval: mocks.enqueueApproval }));
import { POST as execute } from "../../../app/api/agents/[id]/run/route";
import { POST as approve } from "../../../app/api/approvals/[id]/route";
import { POST as draft } from "../../../app/api/agents/draft/route";

beforeEach(() => {
  vi.stubEnv("RUNTIME_ALLOW_DEMO_TOKEN", "true");
  vi.resetAllMocks(); vi.stubEnv("RUNTIME_API_TOKEN", "a-long-demo-token-for-testing");
  mocks.loadAgent.mockResolvedValue(supportAgent);
  mocks.services.mockReturnValue({ store: { claimApproval: mocks.claim }, driver: {}, registry: new Map() });
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, authorized = true) {
  return new Request("http://localhost/api/test", { method: "POST", headers: {
    "content-type": "application/json", "Idempotency-Key": "request-key", ...(authorized ? { authorization: "Bearer a-long-demo-token-for-testing" } : {}),
  }, body: JSON.stringify(body) });
}
const context = { params: Promise.resolve({ id: "support-demo" }) };
it("rejects unauthorized/invalid execution requests before creating a run", async () => {
  expect((await execute(request({ message: "test" }, false), context)).status).toBe(401);
  expect((await execute(request({ message: "test", enabledTools: ["write"] }), context)).status).toBe(400);
  expect(mocks.loadAgent).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});
it("enqueues validated requests with the authenticated owner and returns a durable receipt", async () => {
  const receipt = { jobId: "job", runId: "run", status: "queued" };
  mocks.enqueueRun.mockResolvedValue(receipt);
  const response = await execute(request({ message: "returns?" }), context);
  expect(response.status).toBe(202); expect(await response.json()).toEqual(receipt);
  expect(mocks.enqueueRun).toHaveBeenCalledWith("demo", "support-demo", "returns?", "request-key");
  expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects argument substitution and unavailable approval decisions before enqueuing", async () => {
  expect((await approve(request({ approved: true, input: { subject: "injected" } }), context)).status).toBe(400);
  expect(mocks.enqueueApproval).not.toHaveBeenCalled();
  mocks.enqueueApproval.mockRejectedValue(new Error("approval_unavailable"));
  expect((await approve(request({ approved: true }), context)).status).toBe(409);
  expect(mocks.resume).not.toHaveBeenCalled();
});
it("returns the durable approval job without executing a graph in the request", async () => {
  const receipt = { jobId: "approval-job", runId: "stored-run", status: "queued" };
  mocks.enqueueApproval.mockResolvedValue(receipt);
  const response = await approve(request({ approved: false }), context);
  expect(response.status).toBe(202); expect(await response.json()).toEqual(receipt);
  expect(mocks.enqueueApproval).toHaveBeenCalledWith("demo", "support-demo", false);
  expect(mocks.resume).not.toHaveBeenCalled();
});
it("leaves an approval unclaimed when disconnect happens before the claim", async () => {
  const controller = new AbortController();
  const incoming = new Request(request({ approved: true }), { signal: controller.signal });
  const params = Promise.resolve().then(() => { controller.abort(); return { id: "support-demo" }; });
  const response = await approve(incoming, { params });
  expect(response.status).toBe(408);
  expect(mocks.enqueueApproval).not.toHaveBeenCalled();
  expect(mocks.resume).not.toHaveBeenCalled();
});
it("validates draft requests and returns the editable draft without invoking a run", async () => {
  expect((await draft(request({ goal: "" }))).status).toBe(400);
  mocks.draft.mockResolvedValue({ draft: { name: "Support" }, usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } });
  const response = await draft(request({ goal: "Support agent" }));
  expect((await response.json()).draft.name).toBe("Support");
  expect(mocks.run).not.toHaveBeenCalled();
});
