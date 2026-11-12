import "dotenv/config";
import { randomBytes } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { databaseUrl, databaseConnectionSummary } from "../lib/db/connection";
import { evaluationClient, openEvaluationClient } from "../lib/evals/isolation/connection";

async function main() {
  if (!process.env.EVAL_DATABASE_URL) {
    // Provisioning is opt-in and loopback-only. Hosted databases/roles are operator-managed.
    if (!process.argv.includes("--local") || !databaseConnectionSummary().localEndpoint || (process.env.DATABASE_TARGET ?? "local") !== "local") throw new Error("evaluation_local_setup_required");
    const text = await readFile(".env", "utf8");
    if (/^\s*EVAL_DATABASE_URL\s*=/m.test(text)) throw new Error("evaluation_existing_configuration_requires_review");
    const role = "agentdepot_eval_runner";
    const password = randomBytes(32).toString("hex");
    const url = new URL(databaseUrl()!);
    if (["host", "hostaddr", "port", "database", "user", "password", "options", "service"].some(key => url.searchParams.has(key))) throw new Error("evaluation_database_unsafe_target");
    if (decodeURIComponent(url.pathname.slice(1)) === "agentdepot_eval") throw new Error("evaluation_database_unsafe_target");
    const admin = evaluationClient(url.toString());
    try {
      await admin.connect();
      if ((await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) throw new Error("evaluation_existing_role_requires_configuration");
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
      if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='agentdepot_eval'")).rowCount) {
        await admin.query('CREATE DATABASE "agentdepot_eval"');
        await admin.query('REVOKE ALL ON DATABASE "agentdepot_eval" FROM PUBLIC');
      }
      await admin.query(`GRANT CONNECT, CREATE ON DATABASE "agentdepot_eval" TO "${role}"`);
      url.pathname = "/agentdepot_eval"; url.username = role; url.password = password; url.searchParams.delete("schema");
      process.env.EVAL_DATABASE_URL = url.toString();
      // Local secret only; never printed, committed or sent to another service.
      await appendFile(".env", `\nEVAL_DATABASE_URL=${JSON.stringify(url.toString())}\n`, { mode: 0o600 });
    } finally { await admin.end(); }
  }
  const client = await openEvaluationClient();
  try {
    await client.query("BEGIN");
    await client.query(await readFile(new URL("../prisma/evaluation/001_environment.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
    console.log("Isolated evaluation database ready. Local configuration stays private.");
  } catch { await client.query("ROLLBACK").catch(() => {}); throw new Error("evaluation_schema_setup_failed"); }
  finally { await client.end(); }
}
void main().catch(() => { console.error("Evaluation setup failed. Check the dedicated database, restricted role and local configuration; no live fallback is used."); process.exitCode = 1; });
