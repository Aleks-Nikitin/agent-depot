import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { databaseUrl } from "../lib/db/connection";

async function main() {
  const connectionString = databaseUrl();
  if (!connectionString) throw new Error("database_not_configured");
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 120_000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(841327551)");
    await client.query(await readFile(new URL("../sql/runtime-metrics-timescale.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
    console.log("TimescaleDB runtime metrics configured. Enable RUNTIME_METRICS_BACKEND=timescale for queries.");
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error("metrics_setup_failed: check migrations, TimescaleDB extension availability and setup privileges");
  } finally { await client.end(); }
}
main().catch(() => {
  console.error("metrics_setup_failed: check selected database URL, migrations, TimescaleDB availability and setup privileges");
  process.exitCode = 1;
});
