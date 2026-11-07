import "dotenv/config";
import { randomUUID } from "node:crypto";
import { runOnce } from "graphile-worker";
import { afterAll, expect, it } from "vitest";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { getDb } from "@/lib/db/prisma";
import { createAgent } from "@/lib/agents/library/store";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import type { ModelDriver } from "@/lib/agents/runtime/model";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import { liveDomainRepository } from "@/lib/agents/domain/prisma-repository";
import { createConversation } from "@/lib/agents/sessions/store";
import { createTestCase } from "@/lib/evals/test-cases";
import { getPublishStatus } from "@/lib/evals/publish-gate";
import { workerOptions } from "./graphile";
import { enqueueApproval, enqueueEvaluation, enqueueRun } from "./queue";
import { processExecutionJob } from "./worker";
import { persistedRunStream } from "./events";
import { cancelJob, readJob } from "./queries";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb(); const ownerId = `worker-it-${randomUUID()}`; const agents: string[] = [];
const input = { name: "Worker fixture", instructions: "Create one ticket then answer Done.", model: "gemini", enabledTools: ["create_ticket"] };
const answer = () => ({ text: "Done", calls: [], messages: [], inputTokens: 1, outputTokens: 1 });
const driver: ModelDriver = { key: "worker-fixture", estimate: () => 0.00001, turn: async (_config, messages) => messages.some(m => m.role === "tool") ? answer()
  : { ...answer(), text: "", calls: [{ toolId: "create_ticket", toolCallId: "ticket", input: { subject: "Worker ticket" } }] } };
const deps = { store: new PrismaRunStore(db), driver, registry: runtimeRegistry };
async function agent() { const a = await createAgent(ownerId, input); agents.push(a.id); return a; }
async function drain(services = deps) { const options = workerOptions(services); try { await runOnce({ ...options, concurrency: 1, noHandleSignals: true }); } finally { await options.pgPool.end(); } }
afterAll(async () => {
  for (const run of await db.agentRun.findMany({ where: { ownerId } })) await (await graphCheckpointer()).deleteThread(run.sessionId ? `session:${run.sessionId}` : run.id);
  await db.executionJob.deleteMany({ where: { ownerId } }); await db.localOperation.deleteMany({ where: { ownerId } });
  await db.testRun.deleteMany({ where: { agentId: { in: agents } } }); await db.agentRun.deleteMany({ where: { ownerId } });
  await db.demoTicket.deleteMany({ where: { ownerId } }); await db.agent.deleteMany({ where: { ownerId } });
  await db.workspace.deleteMany({ where: { ownerId } }); await db.$disconnect();
});

it("executes durable jobs through Graphile once, pins conversations, and atomically resumes approvals", async () => {
  const a = await agent(); const session = await createConversation(ownerId, a.id, "draft");
  const key = randomUUID();
  const first = await enqueueRun(ownerId, a.id, "Open a ticket", key, { sessionId: session.id }, deps);
  expect(await enqueueRun(ownerId, a.id, "Open a ticket", key, { sessionId: session.id }, deps)).toEqual(first);
  await expect(enqueueRun(ownerId, a.id, "Different", key, { sessionId: session.id }, deps)).rejects.toThrow("idempotency_key_conflict");
  await expect(readJob("other", first.jobId)).rejects.toThrow("job_not_found");
  expect((await db.conversationSession.findUniqueOrThrow({ where: { id: session.id } })).activeRunId).toBe(first.runId);
  await drain();
  expect(await readJob(ownerId, first.jobId)).toMatchObject({ status: "completed", result: { response: "Done" } });
  await processExecutionJob(first.jobId, deps);
  await db.executionJob.update({ where: { id: first.jobId }, data: { status: "running", result: undefined } });
  await processExecutionJob(first.jobId, deps); // Crash after terminal commit, before queue acknowledgement.
  const operations = await db.localOperation.findMany({ where: { ownerId } }); expect(operations).toHaveLength(1);
  const repository = liveDomainRepository(ownerId);
  const [one, two] = await Promise.all([repository.createTicket(operations[0].key, "Worker ticket"), repository.createTicket(operations[0].key, "Worker ticket")]);
  expect(one).toEqual(two); await expect(repository.createTicket(operations[0].key, "Changed args")).rejects.toThrow("idempotency_conflict");
  expect(await db.demoTicket.count({ where: { ownerId } })).toBe(1);
  const registry = new Map(runtimeRegistry); registry.set("create_ticket", { ...registry.get("create_ticket")!, approvalExempt: false, canAutoWrite: () => false });
  const reviewed = { ...deps, registry };
  const paused = await enqueueRun(ownerId, a.id, "Reviewed ticket", randomUUID(), {}, reviewed); await drain(reviewed);
  const approval = await db.approval.findFirstOrThrow({ where: { runId: paused.runId! } });
  const decision = await enqueueApproval(ownerId, approval.id, true);
  expect(await enqueueApproval(ownerId, approval.id, true)).toEqual(decision);
  await expect(enqueueApproval(ownerId, approval.id, false)).rejects.toThrow("idempotency_key_conflict");
  await drain(reviewed); expect((await deps.store.loadRun(paused.runId!, ownerId)).status).toBe("completed");
  expect(await db.demoTicket.count({ where: { ownerId } })).toBe(2);
});

it("disconnects and reconnects at persisted cursors without cancelling work, and supports explicit cancellation", async () => {
  const a = await agent(); let ready!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; }); const blocked = new Promise<void>(resolve => { release = resolve; });
  const slow = { ...deps, driver: { ...driver, turn: async () => { ready(); await blocked; return answer(); } } };
  const receipt = await enqueueRun(ownerId, a.id, "Wait", randomUUID(), {}, slow);
  const working = drain(slow); await started;
  const stream = await persistedRunStream(new Request("http://localhost/events"), receipt.runId!, ownerId, 0);
  const reader = stream.body!.getReader(); const head = await reader.read(); const events = new TextDecoder().decode(head.value).trim().split("\n").map(line => JSON.parse(line));
  const cursor = events.at(-1).sequence; await reader.cancel();
  expect((await deps.store.loadRun(receipt.runId!, ownerId)).status).toBe("running");
  release(); await working;
  const tail = await persistedRunStream(new Request("http://localhost/events"), receipt.runId!, ownerId, cursor);
  const remaining = (await tail.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(remaining.every(e => e.sequence > cursor)).toBe(true); expect(remaining.at(-1).type).toBe("run_completed");
  const cancelled = await enqueueRun(ownerId, a.id, "Cancel queued", randomUUID(), {}, deps);
  await cancelJob(ownerId, cancelled.jobId); await drain();
  expect((await readJob(ownerId, cancelled.jobId)).status).toBe("cancelled");
  expect((await deps.store.loadRun(cancelled.runId!, ownerId)).state.modelCalls).toBe(0);
  let activeReady!: () => void;
  const activeStarted = new Promise<void>(resolve => { activeReady = resolve; });
  const cancellable = { ...deps, driver: { ...driver, turn: async (_c: unknown, _m: unknown, _t: unknown, signal: AbortSignal) => {
    activeReady(); return new Promise<ReturnType<typeof answer>>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  } } };
  const active = await enqueueRun(ownerId, a.id, "Cancel active", randomUUID(), {}, cancellable);
  const activeWorker = drain(cancellable); await activeStarted; await cancelJob(ownerId, active.jobId); await activeWorker;
  expect((await readJob(ownerId, active.jobId)).status).toBe("cancelled");
  expect((await deps.store.loadRun(active.runId!, ownerId)).status).toBe("failed");
  expect(await db.runtimeMetric.count({ where: { runId: active.runId! } })).toBe(1);
  // A redelivery after an interrupted worker settles the existing run rather than starting it again.
  const interrupted = await enqueueRun(ownerId, a.id, "Interrupted", randomUUID(), {}, deps);
  await liveDomainRepository(ownerId).createTicket(`${interrupted.runId}:ticket`, "Committed before interruption");
  const countBeforeRecovery = await db.demoTicket.count({ where: { ownerId } });
  await db.executionJob.update({ where: { id: interrupted.jobId }, data: { status: "running" } }); await drain();
  expect((await readJob(ownerId, interrupted.jobId)).reason).toBe("worker_interrupted");
  expect((await deps.store.loadRun(interrupted.runId!, ownerId)).state.modelCalls).toBe(0);
  expect(await db.demoTicket.count({ where: { ownerId } })).toBe(countBeforeRecovery);
});

it("runs pinned evaluation suites in the queue and retains complete evidence for publication", async () => {
  const a = await agent(); await createTestCase(ownerId, a.id, { input: "Open a ticket", mustCall: ["create_ticket"], mustContain: ["Done"] });
  const receipt = await enqueueEvaluation(ownerId, a.id, randomUUID(), deps);
  expect((await readJob(ownerId, receipt.jobId)).status).toBe("queued");
  await expect(enqueueEvaluation(ownerId, a.id, randomUUID(), deps)).rejects.toThrow("evaluation_running");
  const live = await db.demoTicket.count({ where: { ownerId } });
  await drain();
  expect(await readJob(ownerId, receipt.jobId)).toMatchObject({ status: "completed", result: { results: [{ status: "passed", outcome: "pass" }] } });
  expect((await getPublishStatus(ownerId, a.id)).canPublish).toBe(true);
  expect(await db.demoTicket.count({ where: { ownerId } })).toBe(live);
});
