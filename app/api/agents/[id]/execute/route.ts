import { z } from "zod";
import { requestOwner } from "@/lib/auth/session";
import { RunRequestSchema } from "@/lib/agents/contracts";
import { httpError, readBody, streamRun } from "@/lib/agents/runtime/http";
import { runtimeServices } from "@/lib/agents/runtime/services";
import { executeServing, executionKey } from "@/lib/agents/releases/execute";
import { resolveServingRelease } from "@/lib/agents/releases/resolve";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await requestOwner(request);
    const { id } = await context.params;
    const { message } = await readBody(request, z.object({ message: RunRequestSchema.shape.message }).strict());
    const key = request.headers.get("Idempotency-Key") ?? "";
    executionKey(ownerId, `serving:${id}`, key);
    await resolveServingRelease(ownerId, id); // Return an explicit conflict before opening the stream.
    return streamRun(request, (signal, onEvent) => executeServing(ownerId, id, message, key, { ...runtimeServices(), signal, onEvent }));
  } catch (error) { return httpError(error); }
}
