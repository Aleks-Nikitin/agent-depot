import { z } from "zod";
import { currentOwner, readJson } from "@/lib/agents/library/http";
import { testCaseError } from "@/lib/evals/test-cases";
import { runtimeServices } from "@/lib/agents/runtime/services";
import { startRepair } from "@/lib/repairs/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request); const { repeats } = z.object({ repeats: z.number().int().min(1).max(2).default(1) }).strict().parse(await readJson(request));
    return Response.json(await startRepair(ownerId, (await context.params).id, runtimeServices(), repeats), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return testCaseError(error); }
}
