import "dotenv/config";
import { runMigrations } from "graphile-worker";
import { workerOptions } from "../lib/jobs/graphile";

async function main() {
  const options = workerOptions();
  try { await runMigrations(options); console.log("Background queue schema ready."); }
  finally { await options.pgPool.end(); }
}
void main().catch(() => { console.error("Background queue setup failed. Check the selected database and migration permissions."); process.exitCode = 1; });
