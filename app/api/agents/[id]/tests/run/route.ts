import { z } from "zod";
import { currentOwner, configError } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { runEvaluation } from "@/lib/evals/runner";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request); const { id } = await context.params;
    await readBody(request, z.object({}).strict());
    return Response.json(await runEvaluation(ownerId, id, request.signal), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return configError(error); }
}
