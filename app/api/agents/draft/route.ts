import { authorize, httpError, readBody } from "@/lib/agents/runtime/http";
import { DraftRequestSchema, draftAgent, budgetedGoogleDraftGenerator } from "@/lib/agents/runtime/draft";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import { getWorkspacePolicy } from "@/lib/workspaces/policy";

export async function POST(request: Request) {
  try {
    const ownerId = await authorize(request);
    const { goal } = await readBody(request, DraftRequestSchema);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const policy = await getWorkspacePolicy(ownerId, true);
    const registry = new Map([...runtimeRegistry].filter(([id]) => policy.allowedTools.includes(id)));
    const result = await draftAgent(goal, registry, budgetedGoogleDraftGenerator(ownerId), signal);
    return Response.json(result);
  } catch (error) { return httpError(error); }
}
