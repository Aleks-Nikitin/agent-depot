import { currentOwner, configError } from "@/lib/agents/library/http";
import { getRun } from "@/lib/runs/queries";

/** GET /api/runs/[id] — one run with its ordered events and approvals. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    const found = await getRun(ownerId, id);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(found);
  } catch (error) {
    return configError(error);
  }
}
