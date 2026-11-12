import { z } from "zod";
import { currentOwner, readJson } from "@/lib/agents/library/http";
import { testCaseError } from "@/lib/evals/test-cases";
import { cancelRepair } from "@/lib/repairs/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const ownerId = await currentOwner(request); z.object({}).strict().parse(await readJson(request));
    await cancelRepair(ownerId, (await context.params).id); return Response.json({ cancelled: true }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return testCaseError(error); }
}
