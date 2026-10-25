import { currentOwner, configError, readJson } from "@/lib/agents/library/http";
import { listAgents, createAgent } from "@/lib/agents/library/store";

export async function GET() {
  try {
    return Response.json({ agents: await listAgents(currentOwner()) });
  } catch (error) {
    return configError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const agent = await createAgent(currentOwner(), body);
    return Response.json(agent, { status: 201 });
  } catch (error) {
    return configError(error);
  }
}
