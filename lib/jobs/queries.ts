import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { receipt } from "./queue";

export async function readJob(ownerId: string, jobId: string) {
  const job = await getDb().executionJob.findFirst({ where: { id: jobId, ownerId } });
  if (!job) throw new HttpError(404, "job_not_found");
  return { ...receipt(job), cancelRequested: job.cancelRequested, reason: job.reason, result: job.result };
}
export async function cancelJob(ownerId: string, jobId: string) {
  const job = await readJob(ownerId, jobId);
  if (["queued", "running"].includes(job.status)) {
    await getDb().executionJob.updateMany({ where: { id: jobId, ownerId, status: { in: ["queued", "running"] } }, data: { cancelRequested: true } });
  }
  return readJob(ownerId, jobId);
}
