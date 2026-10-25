import { createHash } from "node:crypto";
import { EmailInputSchema, TemplateEmailInput, RecordedEmailOutputSchema, renderSupportEmail } from "./email-policy";
import { getDb } from "@/lib/db/prisma";
import { createRegistry, type ToolDefinition } from "@/lib/agents/tools/registry";
import { demoTools } from "./demo-tools";
import { integrationTools } from "./index";
import { knowledgeDocs } from "./data/knowledge";
import { searchKnowledge } from "./knowledgeSearch";

export const runtimeTools: ToolDefinition[] = Object.values(integrationTools).map(tool => ({
  id: tool.id, description: tool.id === "send_email" ? "Prepare a support email. Automatic mode accepts only a support_acknowledgement or review_request template for an existing owned ticketId. Freeform subject/body requires human approval. This integration only records email; it never delivers it." : tool.description,
  kind: tool.kind, automaticWrites: tool.id === "send_email",
  canAutoWrite: tool.id === "send_email" ? input => TemplateEmailInput.safeParse(input).success : undefined,
  outputSchema: tool.id === "send_email" ? RecordedEmailOutputSchema : undefined,
  inputSchema: tool.id === "send_email" ? EmailInputSchema : tool.input,
  async run(input, context) {
    context.signal.throwIfAborted();
    if (tool.id === "knowledge_search") {
      const own = await getDb().knowledgeDocument.findMany({ where: { ownerId: context.ownerId }, orderBy: { createdAt: "desc" }, take: 100 });
      return { ...searchKnowledge(input, own.length ? own : knowledgeDocs), dataKind: own.length ? "workspace_documents" : "illustrative_sample", sample: !own.length };
    }
    if (tool.id === "send_email") {
      const parsed = EmailInputSchema.parse(input);
      if ("ticketId" in parsed && !await getDb().demoTicket.findFirst({ where: { id: parsed.ticketId, ownerId: context.ownerId } })) throw new Error("ticket_not_found");
      const data = "ticketId" in parsed ? renderSupportEmail(parsed) : parsed;
      const dedupKey = "ticketId" in parsed ? `template:${createHash("sha256").update(JSON.stringify([context.ownerId, parsed.ticketId, parsed.template, data.to.toLowerCase()])).digest("hex")}` : null;
      const idempotencyKey = dedupKey ?? context.idempotencyKey;
      const row = await getDb().recordedEmail.upsert({ where: { idempotencyKey },
        create: { ...data, ownerId: context.ownerId, runId: context.runId, toolCallId: context.toolCallId, idempotencyKey },
        update: { idempotencyKey } });
      if (row.ownerId !== context.ownerId || (!dedupKey && (row.runId !== context.runId || row.toolCallId !== context.toolCallId))
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
