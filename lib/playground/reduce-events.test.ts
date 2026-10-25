import { describe, expect, it } from "vitest";
import { RunStepSchema } from "@/lib/agents/contracts";
import { eventFixtures } from "@/lib/agents/fixtures";
import { buildScenario, scenarioKeys } from "@/lib/fixtures/scenarios";
import { addEvents, approvalState, deriveTrace, emptyTrace, describeModelStep } from "./reduce-events";

describe("fixture scenarios", () => {
  it("are valid contract events with unique ids and contiguous sequences", () => {
    for (const key of scenarioKeys) {
      const s = buildScenario(key);
      const all = [s.events, ...(s.continuation ? [s.events.concat(s.continuation.approve), s.events.concat(s.continuation.reject)] : [])];
      for (const events of all) {
        expect(new Set(events.map(e => e.eventId)).size).toBe(events.length);
        events.forEach((e, i) => { expect(RunStepSchema.safeParse(e).success).toBe(true); expect(e.sequence).toBe(i + 1); });
      }
    }
  });
});

describe("deriveTrace", () => {
  it("success: model, tool, model, answer with totals from the completion event", () => {
    const t = deriveTrace(buildScenario("returnPolicy").events);
    expect(t.status).toBe("completed");
    expect(t.items.map(i => i.kind)).toEqual(["model", "tool", "model", "outcome"]);
    expect(t.items[1]).toMatchObject({ toolId: "knowledge_search", status: "succeeded", durationMs: 180 });
    expect(t.items[0]).toMatchObject({ tokens: 402, durationMs: 700 });
    expect(t.totals).toMatchObject({ tokens: 942, costUsd: 0.0012, durationMs: 2100, modelCalls: 2, toolCalls: 1, errors: 0 });
    expect(t.response).toContain("30 days");
  });

  it("approval: pauses with the exact proposed call, then approve continues the same run", () => {
    const s = buildScenario("refundApproval");
    const paused = deriveTrace(s.events);
    expect(paused.status).toBe("waiting_approval");
    expect(paused.pendingApproval).toMatchObject({ toolId: "send_email", input: { to: "customer-1042@example.com" } });
    expect(paused.totals.durationMs).not.toBeNull();

    const approved = addEvents(paused, s.continuation!.approve);
    expect(approved.runId).toBe(paused.runId);
    expect(approved.status).toBe("completed");
    expect(approved.pendingApproval).toBeNull();
    expect(approved.items.find(i => i.kind === "tool" && i.toolId === "send_email")).toMatchObject({ status: "succeeded" });
    expect(approved.lastSequence).toBeGreaterThan(paused.lastSequence);
  });

  it("reject: shows denial, never runs the write, and finishes as rejected", () => {
    const s = buildScenario("refundApproval");
    const t = deriveTrace([...s.events, ...s.continuation!.reject]);
    expect(t.status).toBe("rejected");
    expect(t.items.find(i => i.kind === "tool" && i.toolId === "send_email")).toMatchObject({ status: "denied", reason: "write_denied" });
    expect(t.items.find(i => i.kind === "approval")).toMatchObject({ decision: "rejected" });
    expect(t.totals.errors).toBe(0);
  });

  it.each([["stepLimit", "step_limit"], ["budgetLimit", "budget_limit"]] as const)("%s: blocked with no fabricated answer", (key, reason) => {
    const t = deriveTrace(buildScenario(key).events);
    expect(t.status).toBe("blocked");
    expect(t.stopReason).toBe(reason);
    expect(t.response).toBeNull();
  });

  it("provider failure: failed with a safe reason and an unfinished model step", () => {
    const t = deriveTrace(buildScenario("providerFailure").events);
    expect(t).toMatchObject({ status: "failed", stopReason: "execution_failed", response: null });
    expect(t.items[0]).toMatchObject({ kind: "model", status: "failed" });
    expect(t.totals.errors).toBe(1);
  });

  it("tool failure: failed tool step plus failed run", () => {
    const t = deriveTrace(buildScenario("toolFailure").events);
    expect(t.status).toBe("failed");
    expect(t.items.find(i => i.kind === "tool")).toMatchObject({ status: "failed", reason: "upstream_unavailable" });
    expect(t.totals.errors).toBe(2);
  });

  it("recovered tool error still counts as an error on a succeeded run", () => {
    const t = deriveTrace(buildScenario("competitorPricing").events);
    expect(t.status).toBe("completed");
    expect(t.totals.errors).toBe(1);
    expect(t.totals.toolCalls).toBe(3);
  });

  it("unknown usage stays unknown instead of becoming zero", () => {
    const [start, ...rest] = buildScenario("stepLimit").events;
    const events = [start, ...rest.map(e => e.type === "model_finished" && e.sequence === 3
      ? { ...e, payload: { inputTokens: null, outputTokens: 10, estimatedCostUsd: null } } : e)];
    const t = deriveTrace(events);
    expect(t.totals.tokens).toBeNull();
    expect(t.totals.costUsd).toBeNull();
  });

  it("accepts Dev 2's runtime fixtures too", () => {
    expect(deriveTrace(eventFixtures.success).status).toBe("completed");
    expect(deriveTrace(eventFixtures.waiting).status).toBe("waiting_approval");
    expect(deriveTrace(eventFixtures.rejected).status).toBe("rejected");
    expect(deriveTrace(eventFixtures.approved).status).toBe("completed");
    expect(deriveTrace(eventFixtures.error).status).toBe("failed");
  });
});

describe("addEvents (reload / replay)", () => {
  it("ignores duplicate event ids and duplicate sequences, and orders out-of-order arrivals", () => {
    const events = buildScenario("returnPolicy").events;
    const shuffled = [events[3], events[0], events[1], events[3], events[2]];
    let t = addEvents(emptyTrace, shuffled);
    expect(t.events.map(e => e.sequence)).toEqual([1, 2, 3, 4]);
    t = addEvents(t, [{ ...events[1], eventId: "different-id" }]);
    expect(t.events).toHaveLength(4);
    expect(addEvents(t, events).events).toEqual(events);
  });

  it("reports gaps so the client can fetch history after a lost chunk", () => {
    const events = buildScenario("returnPolicy").events;
    const t = addEvents(emptyTrace, [events[0], events[1], events[4]]);
    expect(t.missingSequences).toEqual([3, 4]);
    expect(addEvents(t, events).missingSequences).toEqual([]);
  });

  it("recovers a waiting run from stored events", () => {
    const t = addEvents(emptyTrace, buildScenario("refundApproval").events);
    expect(t.status).toBe("waiting_approval");
    expect(t.pendingApproval?.id).toBe("fixture-refundApproval-approval-1");
  });

  it("ignores events from another run", () => {
    const a = buildScenario("returnPolicy", "run-a").events;
    const b = buildScenario("returnPolicy", "run-b").events;
    expect(addEvents(addEvents(emptyTrace, a), b).events).toEqual(a);
  });
});

describe("approvalState", () => {
  it("marks pending approvals past their deadline as expired", () => {
    const a = deriveTrace(buildScenario("refundApproval").events).pendingApproval!;
    expect(approvalState(a, Date.parse(a.expiresAt) - 1)).toBe("pending");
    expect(approvalState(a, Date.parse(a.expiresAt))).toBe("expired");
  });
});

it("does not leave a model or requested tool running after a terminal failure", () => {
  const base = eventFixtures.success[0];
  const trace = deriveTrace([
    base,
    { ...base, eventId: "model", sequence: 2, type: "model_started", payload: { step: 1 } },
    { ...base, eventId: "tool", sequence: 3, type: "tool_requested", payload: { toolId: "knowledge_search", toolCallId: "call", input: {} } },
    { ...base, eventId: "failed", sequence: 4, type: "run_failed", payload: { reason: "model_rate_limited" } },
  ]);
  expect(trace.items.find(item => item.kind === "model")).toMatchObject({ status: "failed" });
  expect(trace.items.find(item => item.kind === "tool")).toMatchObject({ status: "failed", reason: "model_rate_limited" });
  expect(describeModelStep(trace.items, 0)).toContain("quota");
  expect(trace.totals.tokens).toBeNull();
});
