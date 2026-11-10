import { currentOwner } from "@/lib/agents/library/http";
import { testCaseError } from "@/lib/evals/test-cases";
import { repairView } from "@/lib/repairs/service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(await repairView(await currentOwner(request), (await context.params).id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return testCaseError(error); }
}
