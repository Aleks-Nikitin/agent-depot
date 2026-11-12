import { processBenchmark } from "@/lib/routing/worker";
import { Logger, type TaskList } from "graphile-worker";
import { Pool } from "pg";
import { z } from "zod";
import { databaseUrl } from "@/lib/db/connection";
import { getDb } from "@/lib/db/prisma";
import { TERMINAL_REPAIRS } from "@/lib/repairs/service";
import { processRepair } from "@/lib/repairs/worker";
import { processExecutionJob } from "./worker";
import type { RuntimeDependencies } from "@/lib/agents/runtime/run-agent";

export function workerOptions(deps?: RuntimeDependencies) {
  const taskList: TaskList = { execute_operation: async (payload, helpers) => {
    const { jobId } = z.object({ jobId: z.uuid() }).strict().parse(payload);
    await processExecutionJob(jobId, deps, undefined, helpers.abortSignal);
  }, repair_operation: async (payload, helpers) => {
    const { caseId } = z.object({ caseId: z.uuid() }).strict().parse(payload);
    try { await processRepair(caseId, deps, {}, helpers.abortSignal); }
    catch (error) {
      if (helpers.job.attempts >= helpers.job.max_attempts && !helpers.abortSignal.aborted) {
        await getDb().repairCase.updateMany({ where: { id: caseId, status: { notIn: TERMINAL_REPAIRS } }, data: { status: "failed", reason: "repair_worker_retry_exhausted" } });
      }
      throw error;
    }
  }, benchmark_operation: async (payload, helpers) => {
    const { benchmarkId } = z.object({ benchmarkId: z.uuid() }).strict().parse(payload);
    try { await processBenchmark(benchmarkId, deps, helpers.abortSignal); }
    catch (error) {
      if (helpers.job.attempts >= helpers.job.max_attempts && !helpers.abortSignal.aborted) await getDb().routingBenchmark.updateMany({ where: { id: benchmarkId, status: { in: ["queued", "running"] } }, data: { status: "failed", reason: "benchmark_execution_unavailable", finishedAt: new Date() } });
      throw error;
    }
  } };
  const pgPool = new Pool({ connectionString: databaseUrl(), max: 5, connectionTimeoutMillis: 10_000 });
  pgPool.on("error", () => { /* Jobs retain durable receipts; do not log connection details. */ });
  pgPool.on("connect", client => client.on("error", () => {}));
  return { pgPool,
    schema: "graphile_worker", concurrency: 2, pollInterval: 500, taskList,
    // Vendor errors may include connection/payload details. Entrypoints emit only safe summaries.
    logger: new Logger(() => () => {}) };
}
