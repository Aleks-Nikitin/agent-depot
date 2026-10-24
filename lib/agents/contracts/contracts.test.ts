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
});
