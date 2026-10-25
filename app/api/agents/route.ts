import { currentOwner, configError, readJson } from "@/lib/agents/library/http";
import { listAgents, createAgent } from "@/lib/agents/library/store";

export async function GET(request: Request) {
  try {
    const ownerId = await currentOwner(request);
    return Response.json({ agents: await listAgents(ownerId) });
  } catch (error) {
    return configError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await currentOwner(request);
    const body = await readJson(request);
    const agent = await createAgent(ownerId, body);
    return Response.json(agent, { status: 201 });
  } catch (error) {
    return configError(error);
  }
}
