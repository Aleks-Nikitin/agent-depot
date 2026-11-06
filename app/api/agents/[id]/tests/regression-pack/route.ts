import { z } from "zod";
import { currentOwner } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { installSupportRegressionPack, testCaseError } from "@/lib/evals/test-cases";
import { SUPPORT_REGRESSION_PACK } from "@/lib/evals/regression-pack";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request); const { id } = await context.params;
    await readBody(request, z.object({}).strict());
    const testCases = await installSupportRegressionPack(ownerId, id);
    return Response.json({ pack: SUPPORT_REGRESSION_PACK, testCases }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return testCaseError(error); }
}
