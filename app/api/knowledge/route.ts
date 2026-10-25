import { z } from "zod";
import { currentOwner, configError } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { getDb } from "@/lib/db/prisma";
import { knowledgeDocs } from "@/lib/integrations/data/knowledge";

const input = z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(8000) }).strict();
export async function GET(request: Request) {
  try {
    const ownerId = await currentOwner(request);
    const docs = await getDb().knowledgeDocument.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 100 });
    return Response.json({ docs, samples: knowledgeDocs }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return configError(error); }
}
export async function POST(request: Request) {
  try {
    const ownerId = await currentOwner(request);
    const data = await readBody(request, input);
    return Response.json({ doc: await getDb().knowledgeDocument.create({ data: { ...data, ownerId } }) }, { status: 201 });
  } catch (error) { return configError(error); }
}
