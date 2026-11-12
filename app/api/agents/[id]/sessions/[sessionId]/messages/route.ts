import { RunRequestSchema } from "@/lib/agents/contracts";
import { requestOwner } from "@/lib/auth/session";
import { httpError, readBody } from "@/lib/agents/runtime/http";
import { enqueueRun } from "@/lib/jobs/queue";
export async function POST(request: Request, context: { params: Promise<{ id: string; sessionId: string }> }) {
  try { const ownerId = await requestOwner(request); const { message } = await readBody(request, RunRequestSchema);
    const { id, sessionId } = await context.params;
    return Response.json(await enqueueRun(ownerId, id, message, request.headers.get("Idempotency-Key") ?? "", { sessionId }), { status: 202 });
  } catch (error) { return httpError(error); }
}
