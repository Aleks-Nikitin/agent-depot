import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/prisma";
import type { PrismaClient } from "@/generated/prisma/client";
import { knowledgeDocs } from "@/lib/integrations/data/knowledge";
import { products } from "@/lib/integrations/data/products";
import type { DomainRepository } from "./repository";
import { artifactHash } from "@/lib/agents/releases/fingerprint";

export function liveDomainRepository(ownerId: string, db: PrismaClient = getDb()): DomainRepository {
  return Object.freeze({
    scope: Object.freeze({ kind: "live" as const, ownerId }),
    async knowledge() {
      const documents = await db.knowledgeDocument.findMany({ where: { ownerId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100, select: { id: true, title: true, text: true } });
      return { documents: documents.length ? documents : structuredClone(knowledgeDocs), sample: documents.length === 0 };
    },
    async products() { return structuredClone(products); },
    async order(orderId: string) {
      return db.workspaceOrder.findUnique({ where: { ownerId_orderId: { ownerId, orderId } }, select: { id: true, orderId: true, status: true, totalCents: true, currency: true } });
    },
    async createTicket(idempotencyKey: string, subject: string) {
      return db.$transaction(async tx => {
        // Serialize identical keys; a receipt and its effect are one local commit.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`;
        const inputHash = artifactHash({ subject });
        const prior = await tx.localOperation.findUnique({ where: { key: idempotencyKey } });
        if (prior && (prior.ownerId !== ownerId || prior.toolId !== "create_ticket" || prior.inputHash !== inputHash)) throw new Error("idempotency_conflict");
        if (prior) return prior.result as { id: string; subject: string };
        // Database conflict arbitration, including simultaneous calls.
        await tx.$executeRaw`INSERT INTO "DemoTicket" ("id", "ownerId", "idempotencyKey", "subject", "createdAt")
          VALUES (${randomUUID()}, ${ownerId}, ${idempotencyKey}, ${subject}, ${new Date()}) ON CONFLICT ("idempotencyKey") DO NOTHING`;
        const ticket = await tx.demoTicket.findUniqueOrThrow({ where: { idempotencyKey } });
        if (ticket.ownerId !== ownerId || ticket.subject !== subject) throw new Error("idempotency_conflict");
        const result = { id: ticket.id, subject: ticket.subject };
        await tx.localOperation.create({ data: { key: idempotencyKey, ownerId, toolId: "create_ticket", inputHash, result } });
        return result;
      });
    },
  });
}
