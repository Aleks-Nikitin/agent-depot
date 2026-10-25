import { currentOwner, configError } from "@/lib/agents/library/http";
import { duplicateAgent } from "@/lib/agents/library/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const agent = await duplicateAgent(currentOwner(), id);
    return Response.json(agent, { status: 201 });
  } catch (error) {
    return configError(error);
  }
}
