import { currentOwner, configError } from "@/lib/agents/library/http";
import { saveKnowledge } from "@/lib/knowledge/store";
import { readKnowledgeUpload } from "@/lib/knowledge/upload";
export async function POST(request: Request) {
  try {
    const ownerId = await currentOwner(request);
    const { id, expectedVersion, sourceName, ...input } = await readKnowledgeUpload(request);
    return Response.json({ doc: await saveKnowledge(ownerId, input, { id, expectedVersion, sourceName }) }, { status: 201 });
  } catch (error) { return configError(error); }
}
