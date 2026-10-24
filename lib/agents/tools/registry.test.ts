import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createRegistry, dispatchTool } from "./registry";
import { supportAgent } from "../fixtures";

it("executes only enabled, validated tools and prevents unapproved writes", async () => {
  const run = vi.fn(async () => ({ answer: "policy" }));
  const registry = createRegistry([
    { id: "knowledge_search", kind: "read", description: "search", inputSchema: z.object({ query: z.string() }), run },
    { id: "create_ticket", kind: "write", description: "write", inputSchema: z.object({ subject: z.string() }), run },
  ]);
  const base = { config: supportAgent, registry, context: {
    ownerId: "demo", runId: "r", toolCallId: "c", signal: new AbortController().signal, idempotencyKey: "r:c",
  } };
  await expect(dispatchTool({ ...base, toolId: "sales_lookup", input: {} })).rejects.toThrow("disabled_tool");
  await expect(dispatchTool({ ...base, toolId: "knowledge_search", input: {} })).rejects.toThrow();
  await expect(dispatchTool({ ...base, toolId: "create_ticket", input: { subject: "test" } })).rejects.toThrow("approval_required");
  expect(run).not.toHaveBeenCalled();
  await expect(dispatchTool({ ...base, toolId: "knowledge_search", input: { query: "returns" } })).resolves.toEqual({ answer: "policy" });
  expect(run).toHaveBeenCalledOnce();
});
