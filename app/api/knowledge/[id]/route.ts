import { currentOwner, configError } from "@/lib/agents/library/http";
import { getDb } from "@/lib/db/prisma";
import { z } from "zod";
import { lockedPolicy } from "@/lib/workspaces/policy";
import { HttpError } from "@/lib/auth/errors";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request); const { id } = await context.params;
    const doc = await getDb().knowledgeDocument.findFirst({ where: { id, ownerId } });
    if (!doc) throw new HttpError(404, "knowledge_not_found");
    const version = new URL(request.url).searchParams.get("version");
    if (version) {
      const number = z.coerce.number().int().positive().parse(version);
      const revision = await getDb().knowledgeRevision.findUnique({ where: { documentId_version: { documentId: id, version: number } } });
      if (!revision) throw new HttpError(404, "knowledge_revision_not_found");
      return Response.json({ revision }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json({ doc, revisions: await getDb().knowledgeRevision.findMany({ where: { documentId: id }, orderBy: { version: "desc" }, take: 50,
      select: { version: true, title: true, sourceName: true, contentHash: true, createdAt: true } }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return configError(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request); const { id } = await context.params;
    const result = await getDb().$transaction(async tx => { await lockedPolicy(tx, ownerId); return tx.knowledgeDocument.deleteMany({ where: { id, ownerId } }); });
    return result.count ? new Response(null, { status: 204 }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) { return configError(error); }
}
