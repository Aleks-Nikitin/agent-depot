import { currentOwner, readJson } from "@/lib/agents/library/http";
import { testCaseError } from "@/lib/evals/test-cases";
import { decideRepair } from "@/lib/repairs/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(await decideRepair(await currentOwner(request), (await context.params).id, await readJson(request)), { status: 202, headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return testCaseError(error); }
}
