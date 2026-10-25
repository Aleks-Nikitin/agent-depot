import { currentOwner, configError } from "@/lib/agents/library/http";
import { getAgent } from "@/lib/agents/library/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const agent = await getAgent(currentOwner(), id);
    return Response.json({ versions: agent.versions });
  } catch (error) {
    return configError(error);
  }
}
