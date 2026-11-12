import { currentOwner, readJson, configError } from "@/lib/agents/library/http";
import { startBenchmark } from "@/lib/routing/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(await startBenchmark(await currentOwner(request), (await context.params).id,
    request.headers.get("idempotency-key") ?? "", await readJson(request)), { status: 202, headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return configError(error); }
}
