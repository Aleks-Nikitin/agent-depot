import { currentOwner, configError } from "@/lib/agents/library/http";
import { getRun } from "@/lib/runs/queries";
import { z } from "zod";
import { getDb } from "@/lib/db/prisma";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";

/** GET /api/runs/[id] — one run with its ordered events and approvals. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    const after = new URL(request.url).searchParams.get("after");
    if (after !== null) {
      const sequence = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(after);
      return Response.json(await new PrismaRunStore(getDb()).history(id, ownerId, sequence), { headers: { "Cache-Control": "private, no-store" } });
    }
    const found = await getRun(ownerId, id);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(found);
  } catch (error) {
    return configError(error);
  }
}
