import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { getDb } from "@/lib/db/prisma";
import { liveDomainRepository } from "@/lib/agents/domain/prisma-repository";
import { z } from "zod";
import { createRegistry } from "@/lib/agents/tools/registry";
import { dispatchTool } from "@/lib/agents/tools/registry";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import { supportAgent } from "@/lib/agents/fixtures";
import { createAgent } from "@/lib/agents/library/store";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { runAgent, resumeAgent } from "@/lib/agents/runtime/run-agent";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import type { ModelDriver } from "@/lib/agents/runtime/model";
import { createTestCase } from "../test-cases";
import { runEvaluation } from "../runner";
import { evaluationConnections, openEvaluationClient } from "./connection";
import { createIsolatedAttempt, cleanupExpiredAttempts } from "./attempt";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb();
const ownerId = `isolation-it-${randomUUID()}`;
const agents: string[] = [];
afterAll(async () => {
  const runs = await db.agentRun.findMany({ where: { ownerId }, select: { id: true } });
  const saver = await graphCheckpointer();
  for (const run of runs) await saver.deleteThread(run.id);
  await db.testRun.deleteMany({ where: { agentId: { in: agents } } });
  await db.agentRun.deleteMany({ where: { ownerId } });
  await db.agent.deleteMany({ where: { ownerId } });
  await db.demoTicket.deleteMany({ where: { ownerId } });
  await db.knowledgeDocument.deleteMany({ where: { ownerId } });
  await db.workspaceOrder.deleteMany({ where: { ownerId } });
  await db.workspace.deleteMany({ where: { ownerId } });
  await db.$disconnect();
});

it("rejects live targets and isolates concurrent fixtures, knowledge and actual ticket effects", async () => {
  expect(() => evaluationConnections({ ...process.env, EVAL_DATABASE_URL: process.env.DATABASE_URL })).toThrow("evaluation_database_unsafe_target");
  const otherServer = new URL(process.env.EVAL_DATABASE_URL!); otherServer.port = "1";
  expect(() => evaluationConnections({ ...process.env, EVAL_DATABASE_URL: otherServer.toString() })).toThrow("evaluation_database_unsafe_target");
  await db.knowledgeDocument.create({ data: { ownerId, title: "Owned policy", text: "Snapshot customers get 30 days." } });
  const knowledge = await liveDomainRepository(ownerId).knowledge();
  const before = await db.demoTicket.count();
  const [first, second] = await Promise.all([1, 2].map(n => createIsolatedAttempt({ ownerId, suiteId: "adapter-it", caseId: `case-${n}`, fixtures: { knowledge } })));
  const admin = await openEvaluationClient();
  try {
    await db.knowledgeDocument.updateMany({ where: { ownerId }, data: { text: "Changed policy: only 2 days." } });
    expect((await first.repository.knowledge()).documents[0].text).toContain("30 days");
    expect((await first.repository.order("1042"))?.status).toBe("delivered");
    const config = { ...supportAgent, ownerId, enabledTools: ["create_ticket"] };
    const context = { domain: first.repository, ownerId, runId: "test", toolCallId: "ticket", idempotencyKey: "same-key", signal: AbortSignal.timeout(10_000) };
    const options = { config, registry: runtimeRegistry, context, toolId: "create_ticket", input: { subject: "Fixture only" }, writeApproved: true };
    const [a, b] = await Promise.all([dispatchTool(options), dispatchTool(options)]);
    expect(a).toEqual(b);
    expect((await first.snapshot()).tickets).toHaveLength(1);
    expect((await second.snapshot()).tickets).toHaveLength(0);
    expect(await db.demoTicket.count()).toBe(before);
    await expect(dispatchTool({ ...options, context: { ...context, ownerId: "another-owner" } })).rejects.toThrow("domain_owner_mismatch");
    await expect(first.repository.createTicket("same-key", "Changed input")).rejects.toThrow("idempotency_conflict");
    await first.dispose();
    await expect(first.repository.createTicket("new-key", "After close")).rejects.toThrow("evaluation_scope_unavailable");
    expect((await admin.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [first.schemaName])).rowCount).toBe(0);
    // Maintenance handles only expired registered scopes, keeping active attempts intact.
    await admin.query('UPDATE agentdepot_eval."Attempt" SET "expiresAt"=now()-interval \'1 second\' WHERE "id"=$1', [second.id]);
    expect(await cleanupExpiredAttempts()).toBeGreaterThanOrEqual(1);
    expect((await admin.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [second.schemaName])).rowCount).toBe(0);
  } finally {
    await first.dispose(); await second.dispose(); await admin.end();
  }
});

it("runs actual write tools inside evaluations and tears down on success, failure and cancellation", async () => {
  const agent = await createAgent(ownerId, { name: "Isolated suite", instructions: "Create a ticket for order 1042.", model: "gemini", enabledTools: ["create_ticket", "knowledge_search", "order_lookup"] }); agents.push(agent.id);
  await createTestCase(ownerId, agent.id, { input: "Create ticket A", mustCall: ["create_ticket"], mustContain: ["Created"] });
  await createTestCase(ownerId, agent.id, { input: "Create ticket B", mustCall: ["create_ticket"], mustContain: ["Created"] });
  const baseline = await db.demoTicket.count();
  const seenAttempts = new Set<string>();
  const effects: number[] = [];
  const model: ModelDriver = { key: "isolated-writer", estimate: () => 0.00001, turn: async (_config, messages) => messages.some(message => message.role === "tool")
    ? { text: "Created", calls: [], messages: [], inputTokens: 1, outputTokens: 1 }
    : { text: "", calls: [{ toolCallId: "ticket", toolId: "create_ticket", input: { subject: "Fixture write" } }], messages: [], inputTokens: 1, outputTokens: 1 } };
  const observingStore = new PrismaRunStore(db);
  const baseCreate = observingStore.createRun.bind(observingStore);
  observingStore.createRun = async (config, checkpoint, binding) => {
    if (checkpoint.domainScope?.kind === "evaluation") seenAttempts.add(checkpoint.domainScope.attemptId);
    return baseCreate(config, checkpoint, binding);
  };
  const readOnly = await openEvaluationClient();
  const observingRegistry = new Map(runtimeRegistry);
  const ticket = runtimeRegistry.get("create_ticket")!;
  observingRegistry.set("create_ticket", { ...ticket, run: async (input, context) => {
    const result = await ticket.run(input, context);
    const registered = await readOnly.query<{ schemaName: string }>('SELECT "schemaName" FROM agentdepot_eval."Attempt" WHERE "id"=$1', [context.domain?.scope.kind === "evaluation" ? context.domain.scope.attemptId : ""]);
    const schema = registered.rows[0].schemaName;
    if (!/^attempt_[a-f0-9]{32}$/.test(schema)) throw new Error("invalid_test_scope");
    effects.push(Number((await readOnly.query(`SELECT count(*) AS count FROM "${schema}"."DemoTicket"`)).rows[0].count));
    return result;
  } });
  const deps = { store: observingStore, registry: observingRegistry, driver: model };
  try {
    const report = await runEvaluation(ownerId, agent.id, undefined, deps);
    expect(report.results.map(result => result.status)).toEqual(["passed", "passed"]);
    expect(effects).toEqual([1, 1]); expect(seenAttempts.size).toBe(2);
    expect(await db.demoTicket.count()).toBe(baseline);
    for (const result of report.results) expect((await db.agentRun.findUniqueOrThrow({ where: { id: result.runId! } })).source).toBe("test");
    expect((await readOnly.query('SELECT 1 FROM agentdepot_eval."Attempt" WHERE "ownerId"=$1', [ownerId])).rowCount).toBe(0);
    const unavailable = await runEvaluation(ownerId, agent.id, undefined, { ...deps, driver: { ...model, turn: async () => { throw new Error("provider unavailable fixture"); } } });
    expect(unavailable.results.every(result => result.status !== "passed")).toBe(true);
    const controller = new AbortController();
    const cancelled = await runEvaluation(ownerId, agent.id, controller.signal, { ...deps, driver: { ...model, turn: async () => { controller.abort(); throw new Error("cancelled fixture"); } } });
    expect(cancelled.results.every(result => result.status !== "passed")).toBe(true);
    expect((await readOnly.query('SELECT 1 FROM agentdepot_eval."Attempt" WHERE "ownerId"=$1', [ownerId])).rowCount).toBe(0);
    expect(await db.demoTicket.count()).toBe(baseline);
    // A saved evaluation cursor cannot be resumed against a live repository after fixture teardown.
    const expiredScope = await createIsolatedAttempt({ ownerId, suiteId: "scope-it", caseId: "expired", fixtures: { knowledge: await liveDomainRepository(ownerId).knowledge() } });
    await expiredScope.dispose();
    await expect(runAgent({ config: { ...supportAgent, ownerId }, ownerId, message: "No live fallback" }, { ...deps, domain: expiredScope.repository })).rejects.toThrow("evaluation_scope_unavailable");
    const policy = (await import("@/lib/workspaces/policy")).WorkspacePolicySchema.parse((await db.workspace.findUniqueOrThrow({ where: { ownerId } })).policy);
    await db.workspace.update({ where: { ownerId }, data: { policy: { ...policy, allowedTools: [...policy.allowedTools, "reviewed_fixture"] } } });
    const pausedScope = await createIsolatedAttempt({ ownerId, suiteId: "scope-it", caseId: "paused", fixtures: { knowledge: await liveDomainRepository(ownerId).knowledge() } });
    let writes = 0;
    const registry = createRegistry([{ id: "reviewed_fixture", description: "Reviewed test write", kind: "write", domainScoped: true,
      inputSchema: z.object({}), run: async () => { writes++; return { created: true }; } }]);
    const reviewedDeps = { ...deps, registry, driver: { ...model, turn: async () => ({ text: "", calls: [{ toolCallId: "reviewed", toolId: "reviewed_fixture", input: {} }], messages: [], inputTokens: 1, outputTokens: 1 }) } };
    try {
      const paused = await runAgent({ config: { ...supportAgent, ownerId, enabledTools: ["reviewed_fixture"] }, ownerId, message: "Pause fixture" }, { ...reviewedDeps, domain: pausedScope.repository });
      expect(paused.status).toBe("waiting_approval");
      await pausedScope.dispose();
      const approval = await db.approval.findFirstOrThrow({ where: { runId: paused.runId } });
      expect(await resumeAgent({ ownerId, approvalId: approval.id, approved: true }, reviewedDeps)).toMatchObject({ status: "blocked", stopReason: "evaluation_scope_unavailable" });
      expect(writes).toBe(0); expect(await db.demoTicket.count()).toBe(baseline);
    } finally { await pausedScope.dispose(); }
  } finally { await readOnly.end(); }
});
