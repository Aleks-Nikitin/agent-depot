import { currentOwner, configError } from "@/lib/agents/library/http";
import { getAgent } from "@/lib/agents/library/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    const agent = await getAgent(ownerId, id);
    return Response.json({ versions: agent.versions });
  } catch (error) {
    return configError(error);
  }
}
