import { currentOwner, configError, readJson } from "@/lib/agents/library/http";
import { getAgent, updateAgent, deleteAgent } from "@/lib/agents/library/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(await getAgent(currentOwner(), id));
  } catch (error) {
    return configError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    return Response.json(await updateAgent(currentOwner(), id, body));
  } catch (error) {
    return configError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await deleteAgent(currentOwner(), id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return configError(error);
  }
}
