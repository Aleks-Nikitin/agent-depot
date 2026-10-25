import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/prisma";
import { createRegistry, type ToolDefinition } from "../agents/tools/registry";

const querySchema = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const ticketSchema = z.object({ subject: z.string().trim().min(1).max(200) }).strict();
const policies = [
  { id: "returns", text: "Unused products can be returned within 30 days with proof of purchase." },
  { id: "shipping", text: "Standard shipping takes 3 to 5 business days." },
];
export const demoTools: ToolDefinition[] = [
  {
    id: "knowledge_search", description: "Search the prepared demo company policy documents.",
    kind: "read", inputSchema: querySchema,
    async run(input) {
      const { query } = querySchema.parse(input);
      const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
      return { source: "demo_policy_dataset", matches: policies.filter(p => words.some(w => p.text.toLowerCase().includes(w))) };
    },
  },
  {
    id: "sales_lookup", description: "Retrieve the prepared demo product sales figures (USD).",
    kind: "read", inputSchema: querySchema,
    async run(input) {
      querySchema.parse(input);
      return { source: "demo_sales_dataset", currency: "USD", rows: [
        { product: "Protein", units: 120, revenue: 3600 },
        { product: "Training shirt", units: 80, revenue: 2000 },
      ] };
    },
  },
  {
    id: "create_ticket", description: "Create a bounded support ticket in the workspace database; available immediately without a human approval step. Find created tickets in Tools & knowledge.",
    kind: "write", inputSchema: ticketSchema, automaticWrites: true, approvalExempt: true,
    outputSchema: z.object({ id: z.string().min(1), subject: z.string().max(200) }).strict(),
    async run(input, context) {
      context.signal.throwIfAborted();
      const { subject } = ticketSchema.parse(input);
      const db = getDb();
      // An empty Prisma upsert update can become a read-then-insert operation.
      // PostgreSQL owns the conflict arbitration even for simultaneous calls.
      await db.$executeRaw`
        INSERT INTO "DemoTicket" ("id", "ownerId", "idempotencyKey", "subject", "createdAt")
        VALUES (${randomUUID()}, ${context.ownerId}, ${context.idempotencyKey}, ${subject}, ${new Date()})
        ON CONFLICT ("idempotencyKey") DO NOTHING
      `;
      const ticket = await db.demoTicket.findUniqueOrThrow({ where: { idempotencyKey: context.idempotencyKey } });
      if (ticket.ownerId !== context.ownerId || ticket.subject !== subject) throw new Error("idempotency_conflict");
      return { id: ticket.id, subject: ticket.subject };
    },
  },
];
export const demoRegistry = createRegistry(demoTools);
