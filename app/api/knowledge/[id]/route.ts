import { currentOwner, configError } from "@/lib/agents/library/http";
import { getDb } from "@/lib/db/prisma";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request); const { id } = await context.params;
    const result = await getDb().knowledgeDocument.deleteMany({ where: { id, ownerId } });
    return result.count ? new Response(null, { status: 204 }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) { return configError(error); }
}
