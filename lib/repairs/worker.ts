import { HttpError } from "@/lib/auth/errors";
import { ZodError } from "zod";
import { Command } from "@langchain/langgraph";
import { getDb } from "@/lib/db/prisma";
import { runtimeServices } from "@/lib/agents/runtime/services";
import type { RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { traceRepairMetadata, withoutPayloadTracing } from "@/lib/agents/runtime/tracing";
import { repairGraph, type RepairHooks } from "./graph";
import { repairThread } from "./checkpointer";
import { validateProposal, TERMINAL_REPAIRS } from "./service";
import { scheduleRepair } from "./schedule";

export async function processRepair(caseId: string, deps = runtimeServices() as RuntimeDependencies, hooks: RepairHooks = {}, signal?: AbortSignal) {
  const db = getDb(); const started = Date.now();
  // Only the Graphile delivery owns progression. This lock also serializes recovery deliveries.
  await db.$transaction(async tx => {
    const key = `repair-step:${caseId}`;
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
    if (!lock.locked) throw new Error("repair_step_busy");
    let row = await db.repairCase.findUniqueOrThrow({ where: { id: caseId } });
    if (TERMINAL_REPAIRS.includes(row.status)) return;
    try {
      validateProposal(row); signal?.throwIfAborted();
      const graph = repairGraph(deps, hooks); const config = { configurable: { thread_id: repairThread(caseId) }, recursionLimit: 16, signal };
      const snapshot = await graph.getState(config);
      if (snapshot.values.graphVersion && snapshot.values.graphVersion !== row.graphVersion) throw new Error("repair_graph_incompatible");
      const pending = snapshot.tasks.flatMap(t => t.interrupts ?? []);
      const waiting = pending[0]?.value as { kind?: string } | undefined;
      let input: Parameters<typeof graph.invoke>[0] = null;
      if (!snapshot.values.caseId) input = { caseId, graphVersion: 1, rejected: false };
      else if (waiting?.kind === "human_review") {
        if (row.approved === null) { await db.repairCase.update({ where: { id: caseId }, data: { status: "review" } }); return; }
        input = new Command({ resume: { approved: row.approved, proposalHash: row.proposalHash } });
      } else if (waiting?.kind === "evaluation") {
        const child = row.childJobId ? await db.executionJob.findUnique({ where: { id: row.childJobId } }) : null;
        if (!child || !["completed", "failed", "cancelled"].includes(child.status)) return;
        input = new Command({ resume: { jobId: child.id } });
      }
      await withoutPayloadTracing(() => graph.invoke(input, config));
      const after = await graph.getState(config);
      const interruptKind = (after.tasks.flatMap(t => t.interrupts ?? [])[0]?.value as { kind?: string } | undefined)?.kind;
      if (interruptKind === "human_review") await db.repairCase.updateMany({ where: { id: caseId, status: "queued" }, data: { status: "review" } });
      row = await db.repairCase.findUniqueOrThrow({ where: { id: caseId } });
      await traceRepairMetadata(row.id, row.status, row.childJobId, row.appliedVersion, row.childJobIds.length, started);
      if (interruptKind === "evaluation" && row.childJobId) {
        const child = await db.executionJob.findUnique({ where: { id: row.childJobId } });
        if (child && ["completed", "failed", "cancelled"].includes(child.status)) await scheduleRepair(tx, caseId, `result-${child.id}`);
      }
    } catch (error) {
      // Infrastructure/checkpoint failures replay through Graphile; semantic failures stop safely.
      // Draft and child-job receipts survive independently of the checkpoint write.
      if (signal?.aborted) throw error;
      if (!(error instanceof HttpError) && !(error instanceof ZodError) && !(error instanceof Error && /^repair_[a-z_]+$/.test(error.message))) throw error;
      const safe = error instanceof Error && /^repair_[a-z_]+$/.test(error.message) ? error.message : "repair_execution_unavailable";
      await db.repairCase.updateMany({ where: { id: caseId, status: { notIn: TERMINAL_REPAIRS } }, data: { status: "failed", reason: safe } });
    }
  }, { timeout: 30_000 });
}
