import { requestOwner } from "@/lib/auth/session";
import { httpError } from "@/lib/agents/runtime/http";
import { conversationView } from "@/lib/agents/sessions/store";

export async function GET(request: Request, context: { params: Promise<{ id: string; sessionId: string }> }) {
  try {
    const ownerId = await requestOwner(request);
    const { id, sessionId } = await context.params;
    return Response.json(await conversationView(ownerId, id, sessionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return httpError(error); }
}
