import { currentOwner, configError } from "@/lib/agents/library/http";
import { readJob } from "@/lib/jobs/queries";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(await readJob(await currentOwner(request), (await context.params).id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return configError(error); }
}
