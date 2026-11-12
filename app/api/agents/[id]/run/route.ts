import { RunRequestSchema } from "@/lib/agents/contracts";
import { authorize, httpError, readBody } from "@/lib/agents/runtime/http";
import { enqueueRun } from "@/lib/jobs/queue";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const ownerId = await authorize(request); const { message } = await readBody(request, RunRequestSchema);
    return Response.json(await enqueueRun(ownerId, (await context.params).id, message, request.headers.get("Idempotency-Key") ?? ""), { status: 202 });
  } catch (error) { return httpError(error); }
}
