import { currentOwner, readJson } from "@/lib/agents/library/http";
import { testCaseError } from "@/lib/evals/test-cases";
import { previewRegression, saveRegression } from "@/lib/repairs/regression";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { return Response.json(await previewRegression(await currentOwner(request), (await context.params).id), { headers }); }
  catch (error) { return testCaseError(error); }
}
export async function POST(request: Request, context: Context) {
  try { return Response.json(await saveRegression(await currentOwner(request), (await context.params).id, await readJson(request)), { status: 201, headers }); }
  catch (error) { return testCaseError(error); }
}
