import { z } from "zod";
import { currentOwner, configError } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { cancelJob } from "@/lib/jobs/queries";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const ownerId = await currentOwner(request); await readBody(request, z.object({}).strict());
    return Response.json(await cancelJob(ownerId, (await context.params).id)); }
  catch (error) { return configError(error); }
}
