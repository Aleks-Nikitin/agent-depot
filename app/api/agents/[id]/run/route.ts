import { RunRequestSchema } from "@/lib/agents/contracts";
import { authorize, httpError, readBody, streamRun } from "@/lib/agents/runtime/http";
import { loadAgent, runtimeServices } from "@/lib/agents/runtime/services";
import { runAgent } from "@/lib/agents/runtime/run-agent";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await authorize(request);
    const { message } = await readBody(request, RunRequestSchema);
    const { id } = await context.params;
    const config = await loadAgent(id, ownerId);
    const services = runtimeServices();
    return streamRun(request, (signal, onEvent) => runAgent({ config, ownerId, message }, { ...services, signal, onEvent }));
  } catch (error) { return httpError(error); }
}
