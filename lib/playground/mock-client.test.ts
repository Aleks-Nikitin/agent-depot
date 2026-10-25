import { describe, expect, it } from "vitest";
import type { RunStep } from "@/lib/agents/contracts";
import { FIXTURE_EPOCH } from "@/lib/fixtures/scenarios";
import { outcomeOf, RunClientError } from "./client";
import { createMockRunClient } from "./mock-client";
import { deriveTrace } from "./reduce-events";

const clock = () => FIXTURE_EPOCH;

describe("mock run client", () => {
  it("streams a successful run and resolves with its outcome", async () => {
    const client = createMockRunClient({ delayMs: 0, now: clock });
    const seen: RunStep[] = [];
    const outcome = await client.startRun({ agentId: "acmestore-support", message: "Can I return a jacket after 20 days?" }, e => seen.push(e));
    expect(outcome.status).toBe("completed");
    expect(outcome.response).toContain("30 days");
    expect(seen.at(-1)?.type).toBe("run_completed");
  });

  it("approve resumes the same run with increasing sequences; a second claim is rejected", async () => {
    const client = createMockRunClient({ delayMs: 0, now: clock });
    const seen: RunStep[] = [];
    const paused = await client.startRun({ agentId: "acmestore-support", message: "Refund order 1042" }, e => seen.push(e));
    expect(paused.status).toBe("waiting_approval");
    const before = seen.length;

    const done = await client.respondToApproval(paused.approvalId!, true, e => seen.push(e));
    expect(done).toMatchObject({ status: "completed", runId: paused.runId });
    expect(new Set(seen.map(e => e.runId))).toEqual(new Set([paused.runId]));
    expect(seen[before].sequence).toBe(seen[before - 1].sequence + 1);

    await expect(client.respondToApproval(paused.approvalId!, true, () => {})).rejects.toMatchObject({ code: "approval_unavailable", status: 409 });
  });

  it("reject finishes as rejected with a safe answer", async () => {
    const client = createMockRunClient({ delayMs: 0, now: clock });
    const paused = await client.startRun({ agentId: "acmestore-support", message: "Refund order 1042" }, () => {});
    const done = await client.respondToApproval(paused.approvalId!, false, () => {});
    expect(done.status).toBe("rejected");
  });

  it("refuses an expired approval", async () => {
    let now = FIXTURE_EPOCH;
    const client = createMockRunClient({ delayMs: 0, now: () => now });
    const paused = await client.startRun({ agentId: "acmestore-support", message: "Refund order 1042" }, () => {});
    now += 16 * 60_000;
    await expect(client.respondToApproval(paused.approvalId!, true, () => {})).rejects.toBeInstanceOf(RunClientError);
  });

  it.each([["stepLimit", "blocked"], ["budgetLimit", "blocked"], ["providerFailure", "failed"], ["toolFailure", "failed"]] as const)(
    "%s resolves as %s", async (scenario, status) => {
      const client = createMockRunClient({ delayMs: 0, now: clock, scenario });
      expect((await client.startRun({ agentId: "x", message: "anything" }, () => {})).status).toBe(status);
    });

  it("replays a waiting run from history, and only the missing tail when asked", async () => {
    const client = createMockRunClient({ delayMs: 0, now: clock });
    const paused = await client.startRun({ agentId: "acmestore-support", message: "Refund order 1042" }, () => {});
    const history = await client.loadRun(paused.runId!);
    expect(history.status).toBe("waiting_approval");
    expect(deriveTrace(history.events).pendingApproval?.id).toBe(paused.approvalId);
    const tail = await client.loadRun(paused.runId!, history.events.length - 2);
    expect(tail.events.map(e => e.sequence)).toEqual(history.events.slice(-2).map(e => e.sequence));
  });

  it("a stream with no terminal event is interrupted, never success", () => {
    const outcome = outcomeOf([{ schemaVersion: 1, eventId: "e1", runId: "r", sequence: 1, timestamp: new Date(FIXTURE_EPOCH).toISOString(),
      type: "run_started", payload: { agentId: "a" } }]);
    expect(outcome).toMatchObject({ status: "interrupted", stopReason: "stream_ended" });
  });
});
