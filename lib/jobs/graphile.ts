import { Logger, type TaskList } from "graphile-worker";
import { Pool } from "pg";
import { z } from "zod";
import { databaseUrl } from "@/lib/db/connection";
import { processExecutionJob } from "./worker";
import type { RuntimeDependencies } from "@/lib/agents/runtime/run-agent";

export function workerOptions(deps?: RuntimeDependencies) {
  const taskList: TaskList = { execute_operation: async (payload, helpers) => {
    const { jobId } = z.object({ jobId: z.uuid() }).strict().parse(payload);
    await processExecutionJob(jobId, deps, undefined, helpers.abortSignal);
  } };
  const pgPool = new Pool({ connectionString: databaseUrl(), max: 5, connectionTimeoutMillis: 10_000 });
  pgPool.on("error", () => { /* Jobs retain durable receipts; do not log connection details. */ });
  pgPool.on("connect", client => client.on("error", () => {}));
  return { pgPool,
    schema: "graphile_worker", concurrency: 2, pollInterval: 500, taskList,
    // Vendor errors may include connection/payload details. Entrypoints emit only safe summaries.
    logger: new Logger(() => () => {}) };
}
