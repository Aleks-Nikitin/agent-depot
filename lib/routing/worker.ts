import { getDb } from "@/lib/db/prisma";
import { modelProfileId } from "@/lib/agents/profiles";
import { runtimeServices } from "@/lib/agents/runtime/services";
import type { RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { enqueueBenchmarkEvaluation } from "@/lib/jobs/queue";
import { BenchmarkPayloadSchema, scheduleBenchmark } from "./service";

export async function notifyBenchmarkChild(jobId: string) {
  const db = getDb(); const row = await db.routingBenchmark.findUnique({ where: { activeJobId: jobId } });
  if (row && ["queued", "running"].includes(row.status)) await db.$transaction(tx => scheduleBenchmark(tx, row.id, jobId));
}
export async function processBenchmark(id: string, deps = runtimeServices() as RuntimeDependencies, signal?: AbortSignal) {
  const db = getDb();
  await db.$transaction(async tx => {
    const key = `benchmark-step:${id}`;
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
    if (!lock.locked) throw new Error("benchmark_step_busy");
    const row = await db.routingBenchmark.findUniqueOrThrow({ where: { id } });
    if (["completed", "failed", "cancelled"].includes(row.status)) return;
    signal?.throwIfAborted();
    const payload = BenchmarkPayloadSchema.parse(row.payload);
    const active = row.activeJobId ? await db.executionJob.findUniqueOrThrow({ where: { id: row.activeJobId } }) : null;
    if (active && !["completed", "failed", "cancelled"].includes(active.status)) return;
    const ordinal = row.childJobIds.length;
    if (ordinal >= row.repeats * 2) {
      await tx.routingBenchmark.updateMany({ where: { id, status: { in: ["queued", "running"] } }, data: { status: "completed", finishedAt: new Date() } }); return;
    }
    // Interleave primary/routed arms on exactly the same full suite and fixtures.
    const config = ordinal % 2 === 0 ? { ...payload.config, routing: { ...payload.policy, mode: "locked" as const, lockedProfile: modelProfileId(payload.config) } } : payload.config;
    const child = await enqueueBenchmarkEvaluation(row.ownerId, row.agentId, `benchmark-${id}-${ordinal}`, { config, baseManifestHash: row.baseManifestHash }, deps);
    await db.$transaction(async claim => {
      await claim.$queryRaw`SELECT "id" FROM "RoutingBenchmark" WHERE "id"=${id} FOR UPDATE`;
      const latest = await claim.routingBenchmark.findUniqueOrThrow({ where: { id } });
      const cancelled = latest.status === "cancelled";
      await claim.routingBenchmark.update({ where: { id }, data: { activeJobId: child.jobId,
        childJobIds: latest.childJobIds.includes(child.jobId) ? latest.childJobIds : [...latest.childJobIds, child.jobId], ...(cancelled ? {} : { status: "running" }) } });
      if (cancelled) await claim.executionJob.update({ where: { id: child.jobId }, data: { cancelRequested: true } });
    });
    const saved = await db.executionJob.findUniqueOrThrow({ where: { id: child.jobId } });
    if (["completed", "failed", "cancelled"].includes(saved.status)) await scheduleBenchmark(tx, id, child.jobId);
  }, { timeout: 30_000 });
}
