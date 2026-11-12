import { z } from "zod";
import { authorize, httpError, readBody } from "@/lib/agents/runtime/http";
import { getDb } from "@/lib/db/prisma";
import { cancelJob } from "@/lib/jobs/queries";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const ownerId = await authorize(request); await readBody(request, z.object({}).strict()); const { id } = await context.params;
    const job = await getDb().executionJob.findFirst({ where: { ownerId, runId: id, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" } });
    if (!job) return Response.json({ error: "active_job_not_found" }, { status: 404 });
    return Response.json(await cancelJob(ownerId, job.id));
  } catch (error) { return httpError(error); }
}
