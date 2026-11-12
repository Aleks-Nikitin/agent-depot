import { currentOwner, readJson, configError } from "@/lib/agents/library/http";
import { routingView, saveRouting } from "@/lib/routing/service";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { return Response.json(await routingView(await currentOwner(request), (await context.params).id), { headers }); }
  catch (error) { return configError(error); }
}
export async function POST(request: Request, context: Context) {
  try { return Response.json(await saveRouting(await currentOwner(request), (await context.params).id, await readJson(request)), { headers }); }
  catch (error) { return configError(error); }
}
