import { describe, expect, it } from "vitest";
import { demoTools } from "@/lib/integrations/demo-tools";
import { TOOL_IDS, TestCaseInputSchema } from "./schema";

const messages = (input: unknown) => {
  const r = TestCaseInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
};

describe("TestCaseInputSchema", () => {
  it("accepts a valid case, trims text and applies defaults", () => {
    expect(TestCaseInputSchema.parse({ input: "  Can I return a jacket?  ", mustCall: ["knowledge_search"], mustContain: [" 30 days "] }))
      .toEqual({ input: "Can I return a jacket?", mustCall: ["knowledge_search"], mustNotCall: [], mustContain: ["30 days"], useGrader: false, source: "user" });
  });

  it("allows planned tools such as send_email", () => {
    expect(messages({ input: "Refund order 1042", mustCall: ["send_email"], source: "template" })).toEqual([]);
  });

  it("rejects an empty or whitespace-only question", () => {
    expect(messages({ input: "   " })).toEqual(["input: Enter the question to test"]);
  });

  it("rejects an unknown tool", () => {
    expect(messages({ input: "q", mustCall: ["delete_everything"] })).toEqual(["mustCall.0: Unknown tool"]);
  });

  it("rejects a tool listed in both Must call and Must not call", () => {
    expect(messages({ input: "q", mustCall: ["send_email"], mustNotCall: ["send_email"] }))
      .toEqual(['mustNotCall: "send_email" can\'t be in both Must call and Must not call']);
  });

  it("rejects empty phrases, unknown sources and unexpected fields", () => {
    expect(messages({ input: "q", mustContain: ["  "] })).toEqual(["mustContain.0: Phrases can't be empty"]);
    expect(messages({ input: "q", source: "robot" })).toHaveLength(1);
    expect(messages({ input: "q", id: "x" })).toHaveLength(1);
  });

  it("covers every tool registered in the runtime", () => {
    for (const tool of demoTools) expect(TOOL_IDS).toContain(tool.id);
  });
});
