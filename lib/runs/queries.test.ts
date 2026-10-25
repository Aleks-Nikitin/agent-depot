import { describe, expect, it } from "vitest";
import { supportAgent } from "@/lib/agents/fixtures";
import { buildScenario } from "@/lib/fixtures/scenarios";
import { displayStatus, runInput, runModel, toRunDetail, toRunStep, toSummary, type RunRow } from "./queries";

// Turns contract events into RunEvent-shaped rows (Date timestamps, no schemaVersion), as Prisma returns them.
const rowsOf = (key: Parameters<typeof buildScenario>[0], extra: "approve" | "reject" | null = null) => {
  const s = buildScenario(key, "r1");
  const events = extra && s.continuation ? [...s.events, ...s.continuation[extra]] : s.events;
  return events.map(e => ({ eventId: e.eventId, runId: e.runId, sequence: e.sequence, type: e.type, payload: e.payload, timestamp: new Date(e.timestamp) }));
};
const checkpoint = (message: string) => ({ messages: [{ role: "user", content: message }], driverKey: "gemini-3.1-flash-lite:0.25:1.5:text-bounded-thinking-v2" });
const row = (over: Partial<RunRow>): RunRow => ({
  id: "r1", agentId: "support-demo", agentVersion: null, status: "completed", configSnapshot: supportAgent,
  checkpoint: checkpoint("Can I return a jacket after 20 days?"), response: "Yes.", stopReason: null,
  createdAt: new Date("2026-10-24T18:00:00Z"), finishedAt: new Date("2026-10-24T18:00:05Z"), ...over,
});

describe("run row mapping", () => {
  it("maps a completed run with active duration, tokens, cost and the real model id", () => {
    const r = toSummary(toRunDetail(row({}), rowsOf("returnPolicy"), "Support"));
    expect(r).toMatchObject({ agentName: "Support", status: "completed", input: "Can I return a jacket after 20 days?",
      model: "gemini-3.1-flash-lite", durationMs: 2100, tokens: 942, costUsd: 0.0012, number: null, version: 1 });
  });

  it("prefers agentVersion, then configSnapshot.version, and falls back to the config name", () => {
    expect(toRunDetail(row({ agentVersion: 3 }), [], "Support").version).toBe(3);
    expect(toRunDetail(row({ configSnapshot: {} }), [], null)).toMatchObject({ version: null, agentName: "support-demo" });
    expect(toRunDetail(row({}), [], null).agentName).toBe("Support");
  });

  it("shows a completed run whose write was rejected as rejected", () => {
    expect(toRunDetail(row({}), rowsOf("refundApproval", "reject"), "Support").status).toBe("rejected");
    expect(toRunDetail(row({}), rowsOf("refundApproval", "approve"), "Support").status).toBe("completed");
  });

  it("keeps an unfinished (paused) run's duration null and carries other statuses through", () => {
    const paused = toRunDetail(row({ status: "waiting_approval", finishedAt: null, response: null }), rowsOf("refundApproval"), "Support");
    expect(paused).toMatchObject({ status: "waiting_approval", durationMs: null });
    expect(toRunDetail(row({ status: "blocked" }), rowsOf("stepLimit"), "Support").status).toBe("blocked");
  });

  it("reports unknown usage as null, not zero", () => {
    expect(toRunDetail(row({ status: "failed" }), rowsOf("providerFailure"), "Support")).toMatchObject({ tokens: null, costUsd: null });
  });

  it("drops event rows that do not match the contract instead of crashing", () => {
    const [good] = rowsOf("returnPolicy");
    expect(toRunStep(good)?.type).toBe("run_started");
    expect(toRunStep({ ...good, type: "made_up" })).toBeNull();
  });

  it("reads the input from the first user message, including text parts", () => {
    expect(runInput({ messages: [{ role: "user", content: [{ type: "text", text: "Refund" }, { type: "text", text: "order 1042" }] }] })).toBe("Refund order 1042");
    expect(runInput(null)).toBe("");
  });

  it("falls back to the config model when the driver key is not a Gemini id", () => {
    expect(runModel({ driverKey: "test" }, { model: "gemini" })).toBe("gemini");
    expect(displayStatus("completed", "completed")).toBe("completed");
  });
});
