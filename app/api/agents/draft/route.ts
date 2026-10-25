import { authorize, httpError, readBody } from "@/lib/agents/runtime/http";
import { DraftRequestSchema, draftAgent, googleDraftGenerator } from "@/lib/agents/runtime/draft";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";

export async function POST(request: Request) {
  try {
    await authorize(request);
    const { goal } = await readBody(request, DraftRequestSchema);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const result = await draftAgent(goal, runtimeRegistry, googleDraftGenerator, signal);
    return Response.json(result);
  } catch (error) { return httpError(error); }
}
