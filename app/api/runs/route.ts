import { currentOwner, configError } from "@/lib/agents/library/http";
import { z } from "zod";
import { listRuns } from "@/lib/runs/queries";

// "succeeded" and "paused" are accepted as aliases for the stored completed / waiting_approval.
const StatusSchema = z.enum(["running", "waiting_approval", "paused", "completed", "succeeded", "rejected", "blocked", "failed", "interrupted"])
  .transform(s => (s === "paused" ? "waiting_approval" : s === "succeeded" ? "completed" : s));

const QuerySchema = z.object({
  agentId: z.string().trim().min(1).max(100).optional(),
  status: StatusSchema.optional(),
  source: z.enum(["playground", "test"]).default("playground"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(100).optional(),
}).strict();

/** GET /api/runs?agentId=&status=&source=&limit=&cursor= — run history, newest first. */
export async function GET(request: Request) {
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_query", issues: parsed.error.issues }, { status: 400 });
  try {
    const ownerId = await currentOwner(request);
    return Response.json(await listRuns(ownerId, parsed.data));
  } catch (error) {
    return configError(error);
  }
}
