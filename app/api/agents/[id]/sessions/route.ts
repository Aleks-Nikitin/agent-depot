import { z } from "zod";
import { requestOwner } from "@/lib/auth/session";
import { httpError, readBody } from "@/lib/agents/runtime/http";
import { createConversation, conversationView } from "@/lib/agents/sessions/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await requestOwner(request);
    const { id } = await context.params;
    const { target, version } = await readBody(request, z.object({ target: z.enum(["draft", "release"]), version: z.number().int().positive().optional() }).strict());
    const session = await createConversation(ownerId, id, target, version);
    return Response.json(await conversationView(ownerId, id, session.id), { status: 201 });
  } catch (error) { return httpError(error); }
}
