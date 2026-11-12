import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/auth/errors";
import { getDb } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { executionKey } from "@/lib/agents/releases/execute";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { prepareAgentRun, type RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { runtimeServices, loadAgent } from "@/lib/agents/runtime/services";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { captureProviderSettings } from "@/lib/agents/releases/provider-settings";
import { resolveServingRelease } from "@/lib/agents/releases/resolve";
import { prepareConversationTurn } from "@/lib/agents/sessions/store";
import { prepareEvaluation } from "@/lib/evals/runner";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
type Prepared = { runId?: string; testRunId?: string; payload: Prisma.InputJsonValue };
async function enqueue(ownerId: string, agentId: string, scope: string, key: string, request: unknown, kind: string,
  prepare: (tx: Prisma.TransactionClient, id: string, key: string) => Promise<Prepared>) {
  const requestKey = executionKey(ownerId, scope, key); const requestHash = artifactHash(request);
  return getDb().$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
    const prior = await tx.executionJob.findUnique({ where: { requestKey } });
    if (prior) {
      if (prior.ownerId !== ownerId || prior.agentId !== agentId || prior.requestHash !== requestHash) throw new HttpError(409, "idempotency_key_conflict");
      return receipt(prior);
    }
    const id = randomUUID();
    const prepared = await prepare(tx, id, requestKey);
    const job = await tx.executionJob.create({ data: { id, ownerId, agentId, requestKey, requestHash, kind, ...prepared } });
    // Same transaction as the receipt, pinned artifact, run/session claim or approval decision.
    await tx.$queryRaw`SELECT (graphile_worker.add_job('execute_operation', ${JSON.stringify({ jobId: id })}::json, job_key := ${id}, max_attempts := 3)).id::text AS id`;
    return receipt(job);
  }, { timeout: 15_000 });
}

export function receipt(job: { id: string; kind: string; status: string; runId: string | null; testRunId: string | null }) {
  return { jobId: job.id, kind: job.kind, status: job.status, runId: job.runId, testRunId: job.testRunId };
}

export async function enqueueRun(ownerId: string, agentId: string, message: string, key: string,
  options: { target?: "draft" | "release"; sessionId?: string } = {}, deps = runtimeServices() as RuntimeDependencies) {
  const scope = options.sessionId ? `conversation:${options.sessionId}` : `${options.target ?? "draft"}:${agentId}`;
  return enqueue(ownerId, agentId, scope, key, { message }, "run", async (tx, _id, requestKey) => {
    const store = new PrismaRunStore(getDb());
    const bound = Object.create(store) as PrismaRunStore;
    bound.createRun = (config, state, binding) => store.createRun(config, state, binding, tx);
    let prepared: Parameters<typeof prepareAgentRun>[0];
    if (options.sessionId) {
      const { session, config, history, providerSettings } = await prepareConversationTurn(ownerId, agentId, options.sessionId, message);
      prepared = { config, history, providerSettings, ownerId, message, binding: { sessionId: session.id, releaseId: session.releaseId ?? undefined,
        input: message, executionKey: requestKey, expectedTurn: session.turnCount, artifactHash: artifactHash({ config, providerSettings }) } };
    } else if (options.target === "release") {
      const artifact = await resolveServingRelease(ownerId, agentId);
      prepared = { ...artifact, ownerId, message, binding: { releaseId: artifact.releaseId, input: message, executionKey: requestKey } };
    } else {
      const config = await loadAgent(agentId, ownerId);
      prepared = { config, ownerId, message, providerSettings: captureProviderSettings(config), binding: { input: message, executionKey: requestKey } };
    }
    const run = await prepareAgentRun(prepared, { ...deps, store: bound });
    return { runId: run.id, payload: {} };
  });
}

export async function enqueueEvaluation(ownerId: string, agentId: string, key: string, deps = runtimeServices() as RuntimeDependencies, expected?: { version: number; manifestHash: string }) {
  return enqueue(ownerId, agentId, `evaluation:${agentId}`, key, expected ?? {}, "evaluation", async (tx, id) => {
    const snapshot = await prepareEvaluation(ownerId, agentId, deps, tx);
    if (expected && (snapshot.config.version !== expected.version || snapshot.manifest.hash !== expected.manifestHash)) throw new HttpError(409, "repair_evaluation_changed");
    await tx.testRun.update({ where: { id: snapshot.record.id }, data: { jobId: id } });
    return { testRunId: snapshot.record.id, payload: json(snapshot) };
  });
}

export async function enqueueApproval(ownerId: string, approvalId: string, approved: boolean) {
  const db = getDb();
  const approval = await db.approval.findFirst({ where: { id: approvalId, run: { ownerId } }, include: { run: true } });
  if (!approval) throw new Error("approval_not_found");
  return enqueue(ownerId, approval.run.agentId, `approval:${approvalId}`, approvalId, { approved }, "approval", async tx => {
    const claim = await new PrismaRunStore(db).claimApproval(approvalId, ownerId, approved, tx);
    return { runId: claim.approval.runId, payload: json({ approvalId, approved, event: claim.event }) };
  });
}

/** Internal-only pinned shadow evaluations; no route accepts a replacement configuration. */
export async function enqueueBenchmarkEvaluation(ownerId: string, agentId: string, key: string,
  benchmark: { config: import("@/lib/agents/contracts").AgentConfig; baseManifestHash: string }, deps: RuntimeDependencies) {
  return enqueue(ownerId, agentId, `benchmark:${agentId}`, key, benchmark, "evaluation", async (tx, id) => {
    const snapshot = await prepareEvaluation(ownerId, agentId, deps, tx, benchmark);
    await tx.testRun.update({ where: { id: snapshot.record.id }, data: { jobId: id } });
    return { testRunId: snapshot.record.id, payload: json(snapshot) };
  });
}
