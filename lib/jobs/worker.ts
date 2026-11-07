import { z } from "zod";
import { getDb } from "@/lib/db/prisma";
import { executePreparedRun, resumeClaimedRun, type RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { runtimeServices } from "@/lib/agents/runtime/services";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { AgentConfigSchema, RunStepSchema } from "@/lib/agents/contracts";
import { ProviderSettingsSchema } from "@/lib/agents/releases/provider-settings";
import { buildEvaluationManifest } from "@/lib/evals/manifest";
import { TestCaseInputSchema } from "@/lib/evals/schema";
import { EvaluationFixturesSchema } from "@/lib/evals/isolation/fixtures";
import { runEvaluation } from "@/lib/evals/runner";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { gradeAnswer } from "@/lib/evals/grader";
import { testReportFromRecord } from "@/lib/evals/publish-gate";

const evaluationSnapshot = z.object({ config: AgentConfigSchema, cases: z.array(TestCaseInputSchema.safeExtend({ id: z.string() }).strip()),
  record: z.object({ id: z.string(), createdAt: z.coerce.date(), providerSettings: ProviderSettingsSchema }),
  knowledge: EvaluationFixturesSchema.shape.knowledge, manifest: z.object({ hash: z.string() }) });

/** Never replay an ambiguous model request/effect after an interrupted worker invocation. */
async function settleInterrupted(job: { ownerId: string; runId: string | null; testRunId: string | null; payload: unknown }, reason: string) {
  const db = getDb(); const store = new PrismaRunStore(db);
  if (job.runId) {
    const run = await store.loadRun(job.runId, job.ownerId);
    if (run.status === "running") await store.finishRun(run.id, job.ownerId, run.version, run.state, "failed", null, reason);
  }
  if (job.testRunId) {
    const snapshot = evaluationSnapshot.parse(job.payload);
    const keys = snapshot.cases.map(test => artifactHash({ suiteId: job.testRunId, caseId: test.id }));
    for (const run of await db.agentRun.findMany({ where: { ownerId: job.ownerId, executionKey: { in: keys }, status: "running" } })) {
      const loaded = await store.loadRun(run.id, job.ownerId);
      await store.finishRun(run.id, job.ownerId, loaded.version, loaded.state, "failed", null, reason);
    }
    // Interrupted evaluations cannot produce passing evidence; do not rerun their cases.
    await db.testRun.updateMany({ where: { id: job.testRunId, status: "running" }, data: { status: "failed", passed: false, finishedAt: new Date() } });
  }
}

export async function processExecutionJob(jobId: string, deps = runtimeServices() as RuntimeDependencies, grader = gradeAnswer, workerSignal?: AbortSignal) {
  const db = getDb();
  const job = await db.executionJob.findUniqueOrThrow({ where: { id: jobId } });
  if (["completed", "failed", "cancelled"].includes(job.status)) return;
  if (job.status === "running") {
    // Graphile delivers one locked job at a time. A second delivery means the earlier worker exited.
    if (job.runId) {
      const run = await db.agentRun.findUnique({ where: { id: job.runId } });
      if (run && run.status !== "running") {
        await db.executionJob.update({ where: { id: jobId }, data: { status: "completed", finishedAt: new Date() } }); return;
      }
    }
    if (job.testRunId) {
      const record = await db.testRun.findUnique({ where: { id: job.testRunId }, include: { manifest: true } });
      if (record?.status === "completed") {
        await db.executionJob.update({ where: { id: jobId }, data: { status: "completed", result: JSON.parse(JSON.stringify(testReportFromRecord(record))), finishedAt: new Date() } }); return;
      }
    }
    await settleInterrupted(job, "worker_interrupted");
    await db.executionJob.update({ where: { id: jobId }, data: { status: "failed", reason: "worker_interrupted", finishedAt: new Date() } }); return;
  }
  const claimed = await db.executionJob.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "running" } });
  if (claimed.count !== 1) return;
  const controller = new AbortController();
  const signal = workerSignal ? AbortSignal.any([workerSignal, controller.signal]) : controller.signal;
  let cancellationRequested = false;
  let checking = false;
  const check = async () => {
    if (checking) return; checking = true;
    try { const current = await db.executionJob.findUniqueOrThrow({ where: { id: jobId } }); if (current.cancelRequested) { cancellationRequested = true; controller.abort(); } }
    catch { controller.abort(); } finally { checking = false; }
  };
  await check();
  const timer = setInterval(() => { void check(); }, 200);
  try {
    let result: unknown;
    const services = { ...deps, signal };
    if (signal.aborted) { await settleInterrupted(job, "cancelled"); }
    else if (job.kind === "run") result = await executePreparedRun(job.runId!, job.ownerId, services);
    else if (job.kind === "approval") {
      const payload = z.object({ approvalId: z.string(), approved: z.boolean(), event: RunStepSchema }).parse(job.payload);
      const approval = await db.approval.findFirstOrThrow({ where: { id: payload.approvalId, runId: job.runId! } });
      result = await resumeClaimedRun({ approval, event: payload.event }, job.ownerId, payload.approved, services);
    } else if (job.kind === "evaluation") {
      const snapshot = evaluationSnapshot.parse(job.payload);
      if (snapshot.config.ownerId !== job.ownerId || snapshot.config.id !== job.agentId || snapshot.record.id !== job.testRunId) throw new Error("job_snapshot_mismatch");
      const manifest = buildEvaluationManifest({ ...snapshot, providerSettings: snapshot.record.providerSettings, registry: deps.registry });
      const saved = await db.evaluationManifest.findUniqueOrThrow({ where: { testRunId: job.testRunId! } });
      if (manifest.hash !== snapshot.manifest.hash || manifest.hash !== saved.hash || artifactHash(saved.payload) !== saved.hash) throw new Error("evaluation_dependencies_changed");
      const record = await db.testRun.findUniqueOrThrow({ where: { id: job.testRunId! } });
      if (record.status !== "running") throw new Error("evaluation_unavailable");
      result = await runEvaluation(job.ownerId, job.agentId, signal, deps, grader, { ...snapshot, record, manifest });
    } else throw new Error("invalid_job_kind");
    if (signal.aborted && job.testRunId) await db.testRun.updateMany({ where: { id: job.testRunId }, data: { status: "failed", passed: false } });
    await db.executionJob.update({ where: { id: jobId }, data: { status: cancellationRequested ? "cancelled" : signal.aborted ? "failed" : "completed",
      reason: signal.aborted ? cancellationRequested ? "cancelled" : "worker_interrupted" : null,
      result: result ? JSON.parse(JSON.stringify(result)) : undefined, finishedAt: new Date() } });
  } catch {
    await settleInterrupted(job, signal.aborted ? "cancelled" : "worker_execution_unavailable");
    await db.executionJob.update({ where: { id: jobId }, data: { status: cancellationRequested ? "cancelled" : "failed", reason: cancellationRequested ? "cancelled" : "worker_execution_unavailable", finishedAt: new Date() } });
  } finally { clearInterval(timer); }
}
