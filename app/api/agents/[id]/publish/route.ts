import { currentOwner, configError, readJson } from "@/lib/agents/library/http";
import { PublishRequestSchema } from "@/lib/agents/library/schema";
import { publishAgent } from "@/lib/agents/library/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { testsPassed } = PublishRequestSchema.parse(await readJson(request));
    return Response.json(await publishAgent(currentOwner(), id, testsPassed));
  } catch (error) {
    return configError(error);
  }
}
