import { currentOwner, configError, readJson } from "@/lib/agents/library/http";
import { RollbackRequestSchema } from "@/lib/agents/library/schema";
import { rollbackAgent } from "@/lib/agents/library/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    const { version } = RollbackRequestSchema.parse(await readJson(request));
    return Response.json(await rollbackAgent(ownerId, id, version));
  } catch (error) {
    return configError(error);
  }
}
