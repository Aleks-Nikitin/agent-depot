import "dotenv/config";
import assert from "node:assert/strict";
import { z } from "zod";
import { getDb } from "../lib/db/prisma";
import { queryRuntimeMetrics } from "../lib/agents/storage/metrics";

async function main() {
  const backend = z.enum(["postgres", "timescale"]).parse(process.env.RUNTIME_METRICS_BACKEND ?? "postgres");
  const db = getDb();
  try {
    const from = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const to = new Date(from.getTime() + 3_600_000);
    const result = await db.$transaction(async tx => {
      const window = { ownerId: "demo", from, to };
      const report = await queryRuntimeMetrics(tx, window, backend);
      // Current-hour real-time metrics should match the raw table. Historical
      // materialized corrections can intentionally be eventually consistent.
      if (backend === "timescale") {
        const raw = await queryRuntimeMetrics(tx, window, "postgres");
        assert.deepEqual(report.buckets, raw.buckets);
      }
      return report;
    }, { isolationLevel: "RepeatableRead" });
    const runs = result.buckets.reduce((total, bucket) => total + bucket.runs, 0);
    console.log(`Metrics check passed: ${backend}, ${runs} terminal run(s) in the current UTC hour. No run contents or credentials printed.`);
  } finally { await db.$disconnect(); }
}
main().catch(() => {
  console.error("metrics_check_failed: check database configuration, migrations, backend and optional TimescaleDB setup");
  process.exitCode = 1;
});
