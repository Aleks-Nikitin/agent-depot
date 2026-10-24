import { ApprovalRequestSchema } from "@/lib/agents/contracts";
import { authorize, httpError, readBody, streamRun } from "@/lib/agents/runtime/http";
import { runtimeServices } from "@/lib/agents/runtime/services";
import { resumeClaimedRun } from "@/lib/agents/runtime/run-agent";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = authorize(request);
    const { approved } = await readBody(request, ApprovalRequestSchema);
    const { id } = await context.params;
    const services = runtimeServices();
    // Claim before sending headers so duplicates/expiry/wrong owner are HTTP errors.
    const claim = await services.store.claimApproval(id, ownerId, approved);
    return streamRun(request, (signal, onEvent) => resumeClaimedRun(claim, ownerId, approved, { ...services, signal, onEvent }));
  } catch (error) { return httpError(error); }
}
