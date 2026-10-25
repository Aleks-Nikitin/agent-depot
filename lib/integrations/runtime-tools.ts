import { z } from "zod";
import { getDb } from "@/lib/db/prisma";
import { createRegistry, type ToolDefinition } from "@/lib/agents/tools/registry";
import { demoTools } from "./demo-tools";
import { integrationTools } from "./index";
import { knowledgeDocs } from "./data/knowledge";
import { searchKnowledge } from "./knowledgeSearch";

const emailInput = z.object({ to: z.email().max(254), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) }).strict();
export const runtimeTools: ToolDefinition[] = Object.values(integrationTools).map(tool => ({
  id: tool.id, description: tool.id === "send_email" ? "Record a proposed customer email after approval. Demo only: no email is delivered." : tool.description,
  kind: tool.kind, inputSchema: tool.id === "send_email" ? emailInput : tool.input,
  async run(input, context) {
    context.signal.throwIfAborted();
    if (tool.id === "knowledge_search") {
      const own = await getDb().knowledgeDocument.findMany({ where: { ownerId: context.ownerId }, orderBy: { createdAt: "desc" }, take: 100 });
      return searchKnowledge(input, [...own, ...knowledgeDocs]);
    }
    if (tool.id === "send_email") {
      const data = emailInput.parse(input);
      const row = await getDb().recordedEmail.upsert({ where: { idempotencyKey: context.idempotencyKey },
        create: { ...data, ownerId: context.ownerId, runId: context.runId, toolCallId: context.toolCallId, idempotencyKey: context.idempotencyKey }, update: { idempotencyKey: context.idempotencyKey } });
      if (row.ownerId !== context.ownerId || row.runId !== context.runId || row.toolCallId !== context.toolCallId
        || row.to !== data.to || row.subject !== data.subject || row.body !== data.body) throw new Error("idempotency_conflict");
      return { status: "recorded", messageId: row.id, ...data, provider: "demo", note: "recorded only, not sent" };
    }
    const result = await tool.run(input, { signal: context.signal });
    if (result && typeof result === "object" && "error" in result) throw new Error("integration_unavailable");
    return result;
  },
}));
// Keep saved configurations using the original local ticket integration compatible.
runtimeTools.push(...demoTools.filter(tool => tool.id === "create_ticket"));
export const runtimeRegistry = createRegistry(runtimeTools);
