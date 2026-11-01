import { z } from "zod";
import { requestOwner } from "@/lib/auth/session";
import { httpError, readBody } from "@/lib/agents/runtime/http";
import { rollbackRelease } from "@/lib/agents/releases/promote";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await requestOwner(request);
    const { id } = await context.params;
    const { releaseId, expectedGeneration } = await readBody(request, z.object({ releaseId: z.string().uuid(), expectedGeneration: z.number().int().nonnegative() }).strict());
    return Response.json(await rollbackRelease(ownerId, id, releaseId, expectedGeneration));
  } catch (error) { return httpError(error); }
}
