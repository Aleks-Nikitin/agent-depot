import { randomUUID } from "node:crypto";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { registerIsolatedRepository, revokeIsolatedRepository, type DomainRepository, type Ticket, type Order } from "@/lib/agents/domain/repository";
import { EvaluationFixturesSchema } from "./fixtures";
import { openEvaluationClient } from "./connection";

function schemaIdentifier(name: string) {
  if (!/^attempt_[a-f0-9]{32}$/.test(name)) throw new Error("evaluation_schema_invalid");
  return `"${name}"`;
}
export async function createIsolatedAttempt(options: { ownerId: string; suiteId: string; caseId: string; fixtures: unknown }) {
  const fixtures = EvaluationFixturesSchema.parse(options.fixtures);
  if (Buffer.byteLength(JSON.stringify(fixtures)) > 2_000_000) throw new Error("evaluation_fixture_limit");
  const id = randomUUID();
  const schemaName = `attempt_${id.replaceAll("-", "")}`;
  const schema = schemaIdentifier(schemaName);
  const knowledgeHash = artifactHash(fixtures.knowledge);
  const client = await openEvaluationClient();
  const ownerId = options.ownerId;
  let open = true;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE TABLE ${schema}."DemoTicket" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL,
      "idempotencyKey" TEXT UNIQUE NOT NULL, "subject" TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ${schema}."WorkspaceOrder" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
      "status" TEXT NOT NULL, "totalCents" INTEGER NOT NULL CHECK ("totalCents" >= 0), "currency" TEXT NOT NULL, UNIQUE ("ownerId", "orderId"));
      CREATE TABLE ${schema}."KnowledgeDocument" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "title" TEXT NOT NULL, "text" TEXT NOT NULL)`);
    await client.query(`INSERT INTO agentdepot_eval."Attempt" ("id", "schemaName", "ownerId", "suiteId", "caseId", "knowledgeHash") VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, schemaName, ownerId, options.suiteId, options.caseId, knowledgeHash]);
    for (const ticket of fixtures.tickets) await client.query(`INSERT INTO ${schema}."DemoTicket" ("id","ownerId","idempotencyKey","subject") VALUES ($1,$2,$3,$4)`, [ticket.id, ownerId, ticket.idempotencyKey, ticket.subject]);
    for (const order of fixtures.orders) await client.query(`INSERT INTO ${schema}."WorkspaceOrder" ("id","ownerId","orderId","status","totalCents","currency") VALUES ($1,$2,$3,$4,$5,$6)`, [order.id, ownerId, order.orderId, order.status, order.totalCents, order.currency]);
    for (const doc of fixtures.knowledge.documents) await client.query(`INSERT INTO ${schema}."KnowledgeDocument" ("id","ownerId","title","text") VALUES ($1,$2,$3,$4)`, [doc.id, ownerId, doc.title, doc.text]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => {}); await client.end().catch(() => {});
    throw new Error("evaluation_fixture_setup_failed");
  }
  function active() { if (!open) throw new Error("evaluation_scope_unavailable"); }
  const repository: DomainRepository = Object.freeze({
    scope: Object.freeze({ kind: "evaluation" as const, ownerId, attemptId: id, knowledgeHash }),
    async knowledge() {
      active();
      const documents = (await client.query(`SELECT "id","title","text" FROM ${schema}."KnowledgeDocument" WHERE "ownerId"=$1 ORDER BY "id"`, [ownerId])).rows;
      return { documents, sample: fixtures.knowledge.sample };
    },
    async products() { active(); return structuredClone(fixtures.products); },
    async order(orderId: string) {
      active();
      return (await client.query<Order>(`SELECT "id","orderId","status","totalCents","currency" FROM ${schema}."WorkspaceOrder" WHERE "ownerId"=$1 AND "orderId"=$2`, [ownerId, orderId])).rows[0] ?? null;
    },
    async createTicket(idempotencyKey: string, subject: string) {
      active();
      await client.query(`INSERT INTO ${schema}."DemoTicket" ("id","ownerId","idempotencyKey","subject") VALUES ($1,$2,$3,$4) ON CONFLICT ("idempotencyKey") DO NOTHING`, [randomUUID(), ownerId, idempotencyKey, subject]);
      active();
      const ticket = (await client.query<Ticket & { ownerId: string }>(`SELECT "id","ownerId","subject" FROM ${schema}."DemoTicket" WHERE "idempotencyKey"=$1`, [idempotencyKey])).rows[0];
      if (!ticket || ticket.ownerId !== ownerId || ticket.subject !== subject) throw new Error("idempotency_conflict");
      return { id: ticket.id, subject: ticket.subject };
    },
  });
  registerIsolatedRepository(repository);
  return {
    id, schemaName, knowledgeHash, repository,
    async snapshot() {
      active();
      return { tickets: (await client.query(`SELECT "id","ownerId","idempotencyKey","subject" FROM ${schema}."DemoTicket" ORDER BY "id"`)).rows,
        orders: (await client.query(`SELECT * FROM ${schema}."WorkspaceOrder" ORDER BY "id"`)).rows };
    },
    async dispose() {
      if (!open) return;
      open = false; revokeIsolatedRepository(repository);
      try {
        await client.query("BEGIN");
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.query(`DELETE FROM agentdepot_eval."Attempt" WHERE "id"=$1 AND "schemaName"=$2`, [id, schemaName]);
        await client.query("COMMIT");
      } catch { await client.query("ROLLBACK").catch(() => {}); throw new Error("evaluation_cleanup_failed"); }
      finally { await client.end().catch(() => {}); }
    },
  };
}

/** Explicit maintenance for abandoned scopes, never a live application-schema reset. */
export async function cleanupExpiredAttempts() {
  const client = await openEvaluationClient();
  let removed = 0;
  try {
    await client.query("BEGIN");
    const expired = await client.query<{ id: string; schemaName: string }>(`SELECT "id","schemaName" FROM agentdepot_eval."Attempt" WHERE "expiresAt" < now() FOR UPDATE SKIP LOCKED`);
    for (const attempt of expired.rows) {
      await client.query(`DROP SCHEMA IF EXISTS ${schemaIdentifier(attempt.schemaName)} CASCADE`);
      await client.query(`DELETE FROM agentdepot_eval."Attempt" WHERE "id"=$1`, [attempt.id]); removed++;
    }
    await client.query("COMMIT"); return removed;
  } catch { await client.query("ROLLBACK").catch(() => {}); throw new Error("evaluation_cleanup_failed"); }
  finally { await client.end().catch(() => {}); }
}
