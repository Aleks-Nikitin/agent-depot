import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/prisma";
export async function scheduleRepair(tx: Prisma.TransactionClient, id: string, phase: string) {
  const key = `repair:${id}:${phase}`;
  await tx.$queryRaw`SELECT (graphile_worker.add_job('repair_operation', ${JSON.stringify({ caseId: id })}::json, job_key := ${key}, max_attempts := 3)).id::text AS id`;
}
/** Also called on redelivery: a settled child can always wake its persisted parent. */
export async function notifyRepairChild(jobId: string) {
  const db = getDb(); const repair = await db.repairCase.findUnique({ where: { childJobId: jobId } });
  if (repair && !["verified", "failed", "rejected", "cancelled"].includes(repair.status)) {
    await db.$transaction(tx => scheduleRepair(tx, repair.id, `result-${jobId}`));
  }
}
