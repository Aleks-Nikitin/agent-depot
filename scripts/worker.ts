import "dotenv/config";
import { repairCheckpointer } from "../lib/repairs/checkpointer";
import { run } from "graphile-worker";
import { workerOptions } from "../lib/jobs/graphile";
import { getDb } from "../lib/db/prisma";
import { graphCheckpointer } from "../lib/agents/runtime/checkpointer";

async function main() {
  const options = workerOptions();
  try {
    const runner = await run(options);
    console.log("Background worker ready. Shutdown waits for active jobs to settle.");
    await runner.promise;
  } finally { await options.pgPool.end(); await getDb().$disconnect(); await (await graphCheckpointer()).end(); await repairCheckpointer().end(); }
}
void main().catch(() => { console.error("Background worker stopped. Check database setup and configuration."); process.exitCode = 1; });
