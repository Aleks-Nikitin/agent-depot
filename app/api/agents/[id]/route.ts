import { currentOwner, configError, readJson } from "@/lib/agents/library/http";
import { getAgent, updateAgent, deleteAgent } from "@/lib/agents/library/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    return Response.json(await getAgent(ownerId, id));
  } catch (error) {
    return configError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    const body = await readJson(request);
    return Response.json(await updateAgent(ownerId, id, body));
  } catch (error) {
    return configError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    await deleteAgent(ownerId, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return configError(error);
  }
}
