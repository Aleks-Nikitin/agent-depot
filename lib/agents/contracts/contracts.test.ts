import { describe, expect, it } from "vitest";
import { AgentConfigSchema, RunStepSchema, RunRequestSchema, ApprovalRequestSchema } from ".";
import { eventFixtures, supportAgent } from "../fixtures";

describe("shared integration contract", () => {
  it("validates sample scenarios with unique, ordered event identities", () => {
    for (const events of Object.values(eventFixtures)) {
      expect(new Set(events.map(e => e.eventId)).size).toBe(events.length);
      events.forEach((e, index) => {
        expect(RunStepSchema.safeParse(e).success).toBe(true);
        expect(e.sequence).toBe(index + 1);
      });
    }
  });
  it("rejects client policy overrides, unsafe limits and argument substitution", () => {
    expect(RunRequestSchema.safeParse({ message: "test", enabledTools: ["write"] }).success).toBe(false);
    expect(ApprovalRequestSchema.safeParse({ approved: true, input: {} }).success).toBe(false);
    expect(AgentConfigSchema.safeParse({ ...supportAgent, requireWriteApproval: false }).success).toBe(false);
    expect(AgentConfigSchema.safeParse({ ...supportAgent, limits: { maxModelCalls: 100 } }).success).toBe(false);
  });
  it("shows approval decisions only after a matching request and never executes a rejected call", () => {
    for (const events of Object.values(eventFixtures)) {
      const approvals = new Map<string, boolean | null>();
      const calls = new Set<string>();
      for (const event of events) {
        if (event.type === "tool_requested") calls.add(event.payload.toolCallId);
        if (event.type === "approval_required") {
          expect(calls.has(event.payload.toolCallId)).toBe(true);
          approvals.set(event.payload.toolCallId, null);
        }
        if (event.type === "approval_resolved") {
          expect(approvals.has(event.payload.toolCallId)).toBe(true);
          approvals.set(event.payload.toolCallId, event.payload.approved);
        }
        if (event.type === "tool_started") {
          expect(calls.has(event.payload.toolCallId)).toBe(true);
          if (approvals.has(event.payload.toolCallId)) expect(approvals.get(event.payload.toolCallId)).toBe(true);
        }
      }
    }
  });
});
