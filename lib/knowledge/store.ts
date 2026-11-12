import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { lockedPolicy } from "@/lib/workspaces/policy";
import { knowledgeDocs } from "@/lib/integrations/data/knowledge";
import { KnowledgeInputSchema } from "./contracts";

export function textDigest(text: string) { return createHash("sha256").update(text).digest("hex"); }
export async function visibleKnowledge(db: Pick<Prisma.TransactionClient, "knowledgeDocument">, ownerId: string, agentId?: string) {
  const documents = await db.knowledgeDocument.findMany({ where: { ownerId, OR: [{ access: "workspace" }, ...(agentId ? [{ access: "agents", agentIds: { has: agentId } }] : [])] },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100,
    select: { id: true, title: true, text: true, version: true, sourceName: true, contentHash: true } });
  const hasPrivate = documents.length > 0 || !!await db.knowledgeDocument.findFirst({ where: { ownerId }, select: { id: true } });
  return { documents: hasPrivate ? documents.map(d => ({ ...d, contentHash: d.contentHash || textDigest(d.text) })) : structuredClone(knowledgeDocs), sample: !hasPrivate };
}
export async function saveKnowledge(ownerId: string, raw: unknown, options: { id?: string; expectedVersion?: number; sourceName?: string } = {}) {
  const input = KnowledgeInputSchema.parse(raw);
  if (Buffer.byteLength(input.text) > 100_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(input.text)) throw new HttpError(400, "knowledge_text_invalid");
  const sourceName = options.sourceName ? z.string().min(1).max(200).regex(/^[^/\\\u0000-\u001F]+$/).parse(options.sourceName) : null;
  return getDb().$transaction(async tx => {
    await lockedPolicy(tx, ownerId);
    if (input.agentIds.length && await tx.agent.count({ where: { ownerId, id: { in: [...new Set(input.agentIds)] } } }) !== new Set(input.agentIds).size) throw new HttpError(404, "agent_not_found");
    const previous = options.id ? await tx.knowledgeDocument.findFirst({ where: { id: options.id, ownerId } }) : null;
    if (options.id && !previous) throw new HttpError(404, "knowledge_not_found");
    if (previous && previous.version !== options.expectedVersion) throw new HttpError(409, "knowledge_version_changed");
    if (!previous && await tx.knowledgeDocument.count({ where: { ownerId } }) >= 100) throw new HttpError(409, "knowledge_document_limit");
    const data = { ...input, agentIds: input.access === "agents" ? [...new Set(input.agentIds)].sort() : [], sourceName,
      version: previous ? previous.version + 1 : 1, contentHash: textDigest(input.text) };
    // Rows created by older integrations may have no revision yet. Capture the
    // old projection once before appending its replacement.
    if (previous) await tx.knowledgeRevision.upsert({ where: { documentId_version: { documentId: previous.id, version: previous.version } }, update: {},
      create: { documentId: previous.id, version: previous.version, title: previous.title, text: previous.text, sourceName: previous.sourceName, contentHash: previous.contentHash || textDigest(previous.text) } });
    const doc = previous ? await tx.knowledgeDocument.update({ where: { id: previous.id }, data }) : await tx.knowledgeDocument.create({ data: { ownerId, ...data } });
    await tx.knowledgeRevision.create({ data: { documentId: doc.id, version: data.version, title: data.title, text: data.text, sourceName: data.sourceName, contentHash: data.contentHash } });
    return doc;
  });
}
