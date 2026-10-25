import { expect, it } from "vitest";
import { z } from "zod";
import { createRegistry } from "../tools/registry";
import { draftAgent, type DraftGenerator } from "./draft";

const registry = createRegistry([{ id: "write", description: "demo", kind: "write", inputSchema: z.object({}), async run() { throw new Error("must not execute"); } }]);
const draft = { name: "Support", instructions: "Answer support questions", model: "gemini", tools: [{ id: "write", reason: "Create tickets", requiresApproval: false }], assumptions: ["Demo workspace"], suggestedTests: [{ input: "Create a ticket", expectedBehavior: "Pause for approval" }] };
const generate: DraftGenerator = async () => ({ draft, usage: { inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0.001 } });
it("forces write approvals through trusted cleanup without executing tools", async () => {
  const output = await draftAgent("support agent", registry, generate, new AbortController().signal);
  expect(output.draft.tools[0].requiresApproval).toBe(true);
});
it("rejects unknown tools, duplicate IDs, and invalid models", async () => {
  for (const invalid of [
    { ...draft, tools: [{ ...draft.tools[0], id: "unknown" }] },
    { ...draft, tools: [draft.tools[0], draft.tools[0]] },
    { ...draft, model: "unknown" },
  ]) {
    await expect(draftAgent("test", registry, async () => ({ draft: invalid, usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } }), new AbortController().signal)).rejects.toThrow();
  }
});
