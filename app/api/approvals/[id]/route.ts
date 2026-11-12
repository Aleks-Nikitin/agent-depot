import { ApprovalRequestSchema } from "@/lib/agents/contracts";
import { authorize, httpError, readBody, HttpError } from "@/lib/agents/runtime/http";
import { enqueueApproval } from "@/lib/jobs/queue";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const ownerId = await authorize(request); const { approved } = await readBody(request, ApprovalRequestSchema);
    const { id } = await context.params;
    if (request.signal.aborted) throw new HttpError(408, "request_aborted");
    return Response.json(await enqueueApproval(ownerId, id, approved), { status: 202 });
  } catch (error) { return httpError(error); }
}
