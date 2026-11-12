import { currentOwner, configError } from "@/lib/agents/library/http";
import { benchmarkView } from "@/lib/routing/report";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(await benchmarkView(await currentOwner(request), (await context.params).id, new URL(request.url).searchParams.get("compareTo") ?? undefined), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return configError(error); }
}
