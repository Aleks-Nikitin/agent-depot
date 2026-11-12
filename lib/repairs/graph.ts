import { Annotation, StateGraph, START, END, interrupt } from "@langchain/langgraph";
import type { RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { getDb } from "@/lib/db/prisma";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { assertNarrowed } from "@/lib/workspaces/policy";
import { enqueueEvaluation } from "@/lib/jobs/queue";
import { readPublishStatus } from "@/lib/evals/publish-gate";
import { repairCheckpointer } from "./checkpointer";
import { identity, validateProposal, TERMINAL_REPAIRS } from "./service";

const State = Annotation.Root({ caseId: Annotation<string>, graphVersion: Annotation<number>, proposalHash: Annotation<string>, rejected: Annotation<boolean>, repeat: Annotation<boolean> });
export type RepairHooks = { afterDraft?: () => void | Promise<void> };
/** All durable side effects below have application receipts independent of graph checkpoints. */
export function repairGraph(deps: RuntimeDependencies, hooks: RepairHooks = {}) {
  const db = getDb();
  const load = async (id: string) => {
    const row = await db.repairCase.findUniqueOrThrow({ where: { id } });
    validateProposal(row);
    if (row.status === "cancelled") throw new Error("repair_cancelled"); return row;
  };
  return new StateGraph(State)
    .addNode("inspect_failed_trace", async state => {
      if (state.graphVersion !== 1) throw new Error("repair_graph_incompatible");
      const row = await load(state.caseId);
      const origin = await db.regressionOrigin.findFirst({ where: { ownerId: row.ownerId, runId: row.sourceRunId, testCaseId: row.testCaseId } });
      if (!origin || artifactHash(origin.evidence) !== origin.sourceHash || origin.sourceHash !== validateProposal(row).sourceHash) throw new Error("repair_source_changed");
      return {};
    })
    .addNode("propose_minimal_config_diff", async state => ({ proposalHash: (await load(state.caseId)).proposalHash }))
    .addNode("interrupt_for_human_review", async state => {
      // Everything before this interrupt is read-only and safe to replay.
      const decision = interrupt<unknown, { approved: boolean; proposalHash: string }>({ kind: "human_review", caseId: state.caseId, proposalHash: state.proposalHash });
      const row = await load(state.caseId);
      if (row.approved !== decision.approved || row.reviewerId !== row.ownerId || row.proposalHash !== decision.proposalHash || row.proposalHash !== state.proposalHash)
        throw new Error("repair_review_mismatch");
      if (!decision.approved) await db.repairCase.updateMany({ where: { id: row.id, status: { not: "cancelled" } }, data: { status: "rejected" } });
      return { rejected: !decision.approved };
    })
    .addNode("apply_to_new_draft", async state => {
      await db.$transaction(async tx => {
        const found = await load(state.caseId);
        const current = await identity(tx, found.ownerId, found.agentId, deps);
        await tx.$queryRaw`SELECT "id" FROM "RepairCase" WHERE "id"=${found.id} FOR UPDATE`;
        const row = await tx.repairCase.findUniqueOrThrow({ where: { id: found.id } });
        const payload = validateProposal(row);
        if (row.status === "cancelled") throw new Error("repair_cancelled");
        // Receipt and new immutable draft commit atomically. Check receipt before base/expiry on replay.
        if (row.appliedVersion !== null) return;
        if (row.approved !== true || row.reviewerId !== row.ownerId || row.proposalHash !== state.proposalHash || !row.decidedAt || row.expiresAt <= new Date()) throw new Error("repair_review_unavailable");
        if (current.manifest.hash !== row.manifestHash || artifactHash(current.config) !== row.baseHash) throw new Error("repair_base_changed");
        assertNarrowed(payload.proposed, current.workspacePolicy);
        await tx.agent.update({ where: { id: row.agentId }, data: { version: payload.proposed.version, config: payload.proposed } });
        await tx.agentDraft.create({ data: { agentId: row.agentId, version: payload.proposed.version, name: payload.proposed.name, config: payload.proposed } });
        await tx.repairCase.update({ where: { id: row.id }, data: { appliedVersion: payload.proposed.version, status: "applied" } });
      }, { timeout: 15_000 });
      await hooks.afterDraft?.(); // Deterministic crash boundary exercised by integration verification.
      return {};
    })
    .addNode("enqueue_regression_and_baseline", async state => {
      const row = await load(state.caseId);
      if (!row.appliedVersion) throw new Error("repair_draft_missing");
      const child = row.childJobId ? { jobId: row.childJobId } : await enqueueEvaluation(row.ownerId, row.agentId, `repair-${row.id}-${row.childJobIds.length + 1}`, deps,
        { version: row.appliedVersion, manifestHash: row.targetManifestHash });
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "RepairCase" WHERE "id"=${row.id} FOR UPDATE`;
        const latest = await tx.repairCase.findUniqueOrThrow({ where: { id: row.id } });
        await tx.repairCase.update({ where: { id: row.id }, data: { childJobId: child.jobId, childJobIds: latest.childJobIds.includes(child.jobId) ? latest.childJobIds : [...latest.childJobIds, child.jobId], ...(latest.status === "cancelled" ? {} : { status: "evaluating" }) } });
        if (latest.status === "cancelled") await tx.executionJob.update({ where: { id: child.jobId }, data: { cancelRequested: true } });
      });
      return {};
    })
    .addNode("await_evaluation", async state => {
      const result = interrupt<unknown, { jobId: string }>({ kind: "evaluation", caseId: state.caseId });
      const row = await load(state.caseId);
      if (!row.childJobId || result.jobId !== row.childJobId) throw new Error("repair_evaluation_mismatch");
      const child = await db.executionJob.findUniqueOrThrow({ where: { id: row.childJobId } });
      if (!["completed", "failed", "cancelled"].includes(child.status)) throw new Error("repair_evaluation_pending");
      return {};
    })
    .addNode("report", async state => {
      const row = await load(state.caseId);
      if (TERMINAL_REPAIRS.includes(row.status)) return {};
      const child = await db.executionJob.findUniqueOrThrow({ where: { id: row.childJobId! } });
      const evidence = child.testRunId ? await db.testRun.findUnique({ where: { id: child.testRunId }, include: { manifest: true } }) : null;
      const gate = await readPublishStatus(db, row.ownerId, row.agentId);
      const current = await db.agent.findUniqueOrThrow({ where: { id: row.agentId } });
      const verified = child.status === "completed" && evidence?.passed === true && evidence.status === "completed" && evidence.manifest?.hash === row.targetManifestHash
        && gate.canPublish && current.version === row.appliedVersion;
      const repeat = verified && row.childJobIds.length < validateProposal(row).repeats;
      await db.repairCase.updateMany({ where: { id: row.id, status: { not: "cancelled" } },
        data: { status: repeat ? "applied" : verified ? "verified" : "failed", ...(repeat ? { childJobId: null } : {}), reason: verified ? null : "repair_retest_not_verified" } });
      return { repeat };
    })
    .addEdge(START, "inspect_failed_trace")
    .addEdge("inspect_failed_trace", "propose_minimal_config_diff")
    .addEdge("propose_minimal_config_diff", "interrupt_for_human_review")
    .addConditionalEdges("interrupt_for_human_review", state => state.rejected ? END : "apply_to_new_draft")
    .addEdge("apply_to_new_draft", "enqueue_regression_and_baseline")
    .addEdge("enqueue_regression_and_baseline", "await_evaluation")
    .addEdge("await_evaluation", "report").addConditionalEdges("report", state => state.repeat ? "enqueue_regression_and_baseline" : END)
    .compile({ checkpointer: repairCheckpointer() });
}
