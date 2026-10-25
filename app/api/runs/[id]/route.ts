import { getRun } from "@/lib/runs/queries";

/** GET /api/runs/[id] — one run with its ordered events and approvals. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const found = await getRun(id);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(found);
  } catch {
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
