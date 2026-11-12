import { Client } from "pg";
import { databaseUrl } from "@/lib/db/connection";

export function evaluationConnections(env: NodeJS.ProcessEnv = process.env) {
  const application = databaseUrl(env);
  if (!application || !env.EVAL_DATABASE_URL) throw new Error("evaluation_database_not_configured");
  let live: URL; let isolated: URL;
  try { live = new URL(application); isolated = new URL(env.EVAL_DATABASE_URL); }
  catch { throw new Error("evaluation_database_invalid"); }
  const host = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "loopback" : url.hostname.toLowerCase();
  const db = (url: URL) => decodeURIComponent(url.pathname.slice(1));
  if (![live, isolated].every(url => ["postgres:", "postgresql:"].includes(url.protocol))
    || db(live) === "agentdepot_eval" || db(isolated) !== "agentdepot_eval"
    || host(live) !== host(isolated) || (live.port || "5432") !== (isolated.port || "5432")
    || !isolated.username || decodeURIComponent(live.username) === decodeURIComponent(isolated.username)
    || [...isolated.searchParams.keys()].some(key => !["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "application_name", "connect_timeout"].includes(key))) {
    throw new Error("evaluation_database_unsafe_target");
  }
  return { application, isolated: env.EVAL_DATABASE_URL, role: decodeURIComponent(isolated.username) };
}

export function evaluationClient(connectionString: string) {
  return new Client({ connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 7_000 });
}

/** Check actual server/database/role identity before any fixture mutation. No live fallback. */
export async function openEvaluationClient(env: NodeJS.ProcessEnv = process.env) {
  const urls = evaluationConnections(env);
  const isolated = evaluationClient(urls.isolated);
  const live = evaluationClient(urls.application);
  try {
    await isolated.connect();
    const identity = (await isolated.query<{ database: string; role: string; privileged: boolean; started: Date }>(`
      SELECT current_database() AS database, current_user AS role, pg_postmaster_start_time() AS started,
        (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR EXISTS
          (SELECT 1 FROM pg_auth_members WHERE member = r.oid)) AS privileged
      FROM pg_roles r WHERE rolname = current_user`)).rows[0];
    if (!identity || identity.database !== "agentdepot_eval" || identity.role !== urls.role || identity.privileged) throw new Error("evaluation_database_unsafe_role");
    await live.connect();
    const boundary = (await live.query<{ database: string; role: string; started: Date; writable: boolean }>(`
      SELECT current_database() AS database, current_user AS role, pg_postmaster_start_time() AS started,
        (has_table_privilege($1, 'public."DemoTicket"', 'INSERT,UPDATE,DELETE')
        OR has_table_privilege($1, 'public."KnowledgeDocument"', 'INSERT,UPDATE,DELETE')
        OR has_table_privilege($1, 'public."WorkspaceOrder"', 'INSERT,UPDATE,DELETE')) AS writable`, [urls.role])).rows[0];
    if (!boundary || boundary.database === "agentdepot_eval" || boundary.role === identity.role || boundary.writable || boundary.started.getTime() !== identity.started.getTime()) throw new Error("evaluation_database_unsafe_target");
    return isolated;
  } catch (error) {
    await isolated.end().catch(() => {});
    if (error instanceof Error && error.message.startsWith("evaluation_database_")) throw error;
    throw new Error("evaluation_database_unavailable");
  } finally { await live.end().catch(() => {}); }
}
