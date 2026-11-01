import { HttpError } from "@/lib/auth/errors";
import { requestOwner } from "@/lib/auth/session";
import { RunRequestSchema } from "@/lib/agents/contracts";
import { httpError, readBody, streamRun } from "@/lib/agents/runtime/http";
import { runtimeServices } from "@/lib/agents/runtime/services";
import { getConversation, prepareConversationTurn, sendConversationTurn } from "@/lib/agents/sessions/store";
import { executionKey } from "@/lib/agents/releases/execute";
import { getDb } from "@/lib/db/prisma";

export async function POST(request: Request, context: { params: Promise<{ id: string; sessionId: string }> }) {
  try {
    const ownerId = await requestOwner(request);
    const { id, sessionId } = await context.params;
    const { message } = await readBody(request, RunRequestSchema);
    const key = request.headers.get("Idempotency-Key") ?? "";
    const receiptKey = executionKey(ownerId, `conversation:${sessionId}`, key);
    await getConversation(ownerId, id, sessionId);
    const prior = await getDb().agentRun.findUnique({ where: { executionKey: receiptKey } });
    if (prior && prior.input !== message) throw new HttpError(409, "idempotency_key_conflict");
    if (!prior) await prepareConversationTurn(ownerId, id, sessionId, message);
    return streamRun(request, (signal, onEvent) => sendConversationTurn(ownerId, id, sessionId, message, key, { ...runtimeServices(), signal, onEvent }));
  } catch (error) { return httpError(error); }
}
