import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supportAgent, eventFixtures } from "../fixtures";

const mocks = vi.hoisted(() => ({ loadAgent: vi.fn(), services: vi.fn(), run: vi.fn(), resume: vi.fn(), draft: vi.fn(), claim: vi.fn() }));
vi.mock("./services", () => ({ loadAgent: mocks.loadAgent, runtimeServices: mocks.services }));
vi.mock("./run-agent", () => ({ runAgent: mocks.run, resumeClaimedRun: mocks.resume }));
vi.mock("./draft", async importOriginal => ({ ...(await importOriginal<typeof import("./draft")>()), draftAgent: mocks.draft }));
import { POST as execute } from "../../../app/api/agents/[id]/run/route";
import { POST as approve } from "../../../app/api/approvals/[id]/route";
import { POST as draft } from "../../../app/api/agents/draft/route";

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("RUNTIME_API_TOKEN", "a-long-demo-token-for-testing");
  mocks.loadAgent.mockResolvedValue(supportAgent);
  mocks.services.mockReturnValue({ store: { claimApproval: mocks.claim }, driver: {}, registry: new Map() });
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, authorized = true) {
  return new Request("http://localhost/api/test", { method: "POST", headers: {
    "content-type": "application/json", ...(authorized ? { authorization: "Bearer a-long-demo-token-for-testing" } : {}),
  }, body: JSON.stringify(body) });
}
const context = { params: Promise.resolve({ id: "support-demo" }) };
it("rejects unauthorized/invalid execution requests before creating a run", async () => {
  expect((await execute(request({ message: "test" }, false), context)).status).toBe(401);
  expect((await execute(request({ message: "test", enabledTools: ["write"] }), context)).status).toBe(400);
  expect(mocks.loadAgent).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});
it("passes server-owned configuration and streams the agreed event format", async () => {
  mocks.run.mockImplementation(async (_options, deps) => {
    for (const event of eventFixtures.success) deps.onEvent(event);
  });
  const response = await execute(request({ message: "returns?" }), context);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(response.headers.get("content-type")).toContain("application/x-ndjson");
  expect(events).toEqual(eventFixtures.success);
  expect(mocks.run).toHaveBeenCalledWith({ config: supportAgent, ownerId: "demo", message: "returns?" }, expect.anything());
});
it("rejects argument substitution and duplicate approval decisions before streaming", async () => {
  expect((await approve(request({ approved: true, input: { subject: "injected" } }), context)).status).toBe(400);
  expect(mocks.claim).not.toHaveBeenCalled();
  mocks.claim.mockRejectedValue(new Error("approval_unavailable"));
  expect((await approve(request({ approved: true }), context)).status).toBe(409);
  expect(mocks.resume).not.toHaveBeenCalled();
});
it("streams approval resolution using the server's stored claim", async () => {
  const claim = { event: eventFixtures.rejected[5], approval: { id: "stored-approval", runId: "fixture-run" } };
  mocks.claim.mockResolvedValue(claim);
  mocks.resume.mockImplementation(async (_claim, _owner, _decision, deps) => deps.onEvent(claim.event));
  const response = await approve(request({ approved: false }), context);
  await response.text();
  expect(mocks.claim).toHaveBeenCalledWith("support-demo", "demo", false);
  expect(mocks.resume).toHaveBeenCalledWith(claim, "demo", false, expect.anything());
});
it("validates draft requests and returns the editable draft without invoking a run", async () => {
  expect((await draft(request({ goal: "" }))).status).toBe(400);
  mocks.draft.mockResolvedValue({ draft: { name: "Support" }, usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } });
  const response = await draft(request({ goal: "Support agent" }));
  expect((await response.json()).draft.name).toBe("Support");
  expect(mocks.run).not.toHaveBeenCalled();
});
