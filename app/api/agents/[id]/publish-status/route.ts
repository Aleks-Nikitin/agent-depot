import { currentOwner } from "@/lib/agents/library/http";
import { z } from "zod";
import { getPublishStatus } from "@/lib/evals/publish-gate";
import { testCaseError } from "@/lib/evals/test-cases";

const QuerySchema = z.object({ version: z.coerce.number().int().positive().optional() }).strict();

/** GET /api/agents/[id]/publish-status?version= — whether that version (default: current) may be published. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    const { version } = QuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getPublishStatus(ownerId, id, version));
  } catch (error) {
    return testCaseError(error); // 400 invalid query, 404 agent_not_found
  }
}
