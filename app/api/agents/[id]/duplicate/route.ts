import { currentOwner, configError } from "@/lib/agents/library/http";
import { duplicateAgent } from "@/lib/agents/library/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    const agent = await duplicateAgent(ownerId, id);
    return Response.json(agent, { status: 201 });
  } catch (error) {
    return configError(error);
  }
}
