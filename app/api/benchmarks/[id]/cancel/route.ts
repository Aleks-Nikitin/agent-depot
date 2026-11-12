import { z } from "zod";
import { currentOwner, readJson, configError } from "@/lib/agents/library/http";
import { cancelBenchmark } from "@/lib/routing/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const owner = await currentOwner(request); z.object({}).strict().parse(await readJson(request));
    await cancelBenchmark(owner, (await context.params).id); return Response.json({ cancelled: true }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return configError(error); }
}
