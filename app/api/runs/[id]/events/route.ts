import { z } from "zod";
import { authorize, httpError } from "@/lib/agents/runtime/http";
import { persistedRunStream } from "@/lib/jobs/events";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const ownerId = await authorize(request); const { id } = await context.params;
    const after = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).safeParse(new URL(request.url).searchParams.get("after") ?? 0);
    if (!after.success) return Response.json({ error: "invalid_cursor" }, { status: 400 });
    return await persistedRunStream(request, id, ownerId, after.data);
  } catch (error) { return httpError(error); }
}
