import "dotenv/config";
import { spawnSync } from "node:child_process";

// Deliberately target only the isolated Compose database, never DATABASE_URL.
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("POSTGRES_PASSWORD is required for the isolated TimescaleDB test container");
const port = Number(process.env.TIMESCALE_TEST_PORT ?? 55434);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid_test_port");
const databaseUrl = `postgresql://agent_depot:${encodeURIComponent(password)}@localhost:${port}/agent_depot_metrics_test?schema=public`;
const env = { ...process.env, DATABASE_TARGET: "local", DATABASE_URL: databaseUrl, RUNTIME_METRICS_BACKEND: "postgres" };
for (const args of [
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["--import", "tsx", "scripts/setup-runtime-metrics.ts"],
  // Repeat setup to prove safe re-execution.
  ["--import", "tsx", "scripts/setup-runtime-metrics.ts"],
  ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.timescale.config.mts"],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error || result.status !== 0) { process.exitCode = 1; break; }
}
