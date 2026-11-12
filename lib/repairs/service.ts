import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Prisma, RepairCase } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { AgentConfigSchema } from "@/lib/agents/contracts";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { captureProviderSettings } from "@/lib/agents/releases/provider-settings";
import { runtimeServices } from "@/lib/agents/runtime/services";
import type { RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { buildEvaluationManifest, evaluationKnowledge } from "@/lib/evals/manifest";
import { testFingerprint } from "@/lib/evals/fingerprint";
import { testReportFromRecord } from "@/lib/evals/publish-gate";
import { assertNarrowed, lockedPolicy } from "@/lib/workspaces/policy";
import { json } from "./regression";
import { scheduleRepair } from "./schedule";

export const RepairPayloadSchema = z.object({ base: AgentConfigSchema, proposed: AgentConfigSchema,
  repeats: z.number().int().min(1).max(2), invariant: z.string().min(1).max(2000), regressionHash: z.string(), sourceHash: z.string(), baseline: z.unknown() }).strict();
export const ReviewSchema = z.object({ proposalHash: z.string().regex(/^[a-f0-9]{64}$/), approved: z.boolean() }).strict();
export const TERMINAL_REPAIRS = ["verified", "failed", "rejected", "cancelled"];
export async function ownedRepair(ownerId: string, id: string) {
  const row = await getDb().repairCase.findFirst({ where: { id, ownerId } });
  if (!row) throw new HttpError(404, "repair_not_found"); return row;
}
export async function identity(tx: Prisma.TransactionClient, ownerId: string, agentId: string, deps: RuntimeDependencies) {
  const locked = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 0 } } });
  if (locked.count !== 1) throw new HttpError(404, "agent_not_found");
  const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
  const config = AgentConfigSchema.parse(agent.config);
  const workspacePolicy = await lockedPolicy(tx, ownerId, true, config); assertNarrowed(config, workspacePolicy);
  const cases = await tx.testCase.findMany({ where: { agentId } });
  const knowledge = await evaluationKnowledge(tx, ownerId, agentId); const providerSettings = captureProviderSettings(config);
  const manifest = buildEvaluationManifest({ config, cases, knowledge, providerSettings, workspacePolicy, registry: deps.registry });
  return { config, cases, knowledge, providerSettings, workspacePolicy, manifest };
}
export function validateProposal(row: RepairCase) {
  if (row.graphVersion !== 1) throw new HttpError(409, "repair_graph_incompatible");
  const payload = RepairPayloadSchema.parse(row.payload);
  const expected = AgentConfigSchema.parse({ ...payload.base, version: payload.base.version + 1,
    instructions: `${payload.base.instructions}\n\nReviewed regression requirement:\n${payload.invariant}` });
  if (artifactHash(payload.base) !== row.baseHash || artifactHash(expected) !== artifactHash(payload.proposed)
    || artifactHash({ proposed: payload.proposed, baseHash: row.baseHash, manifestHash: row.manifestHash, sourceHash: payload.sourceHash, regressionHash: payload.regressionHash, repeats: payload.repeats }) !== row.proposalHash)
    throw new HttpError(409, "repair_proposal_changed");
  return payload;
}
export async function startRepair(ownerId: string, runId: string, deps = runtimeServices() as RuntimeDependencies, repeats = 1) {
  z.number().int().min(1).max(2).parse(repeats);
  return getDb().$transaction(async tx => {
    const origin = await tx.regressionOrigin.findFirst({ where: { runId, ownerId }, include: { testCase: true } });
    if (!origin) throw new HttpError(409, "review_regression_first");
    if (artifactHash(origin.evidence) !== origin.sourceHash) throw new HttpError(409, "repair_source_changed");
    const current = await identity(tx, ownerId, origin.testCase.agentId, deps);
    const test = current.cases.find(c => c.id === origin.testCaseId)!;
    const invariant = test.expectedBehavior?.trim(); if (!invariant) throw new HttpError(409, "regression_requires_reviewed_assertion");
    // The saved review, not a failed model answer, supplies the proposed requirement.
    const regressionHash = artifactHash(testFingerprint([test]));
    const proposed = AgentConfigSchema.parse({ ...current.config, version: current.config.version + 1,
      instructions: `${current.config.instructions}\n\nReviewed regression requirement:\n${invariant}` });
    const baseHash = artifactHash(current.config); const manifestHash = current.manifest.hash;
    const proposalHash = artifactHash({ proposed, baseHash, manifestHash, sourceHash: origin.sourceHash, regressionHash, repeats });
    const requestKey = artifactHash({ ownerId, runId, proposalHash });
    const prior = await tx.repairCase.findUnique({ where: { requestKey } }); if (prior) return { id: prior.id };
    const target = buildEvaluationManifest({ ...current, config: proposed, registry: deps.registry });
    const previous = await tx.testRun.findFirst({ where: { purpose: "certification", agentId: current.config.id, agentVersion: current.config.version, status: "completed" }, include: { manifest: true }, orderBy: { createdAt: "desc" } });
    const id = randomUUID();
    await tx.repairCase.create({ data: { id, ownerId, agentId: current.config.id, sourceRunId: runId, testCaseId: test.id, requestKey,
      baseVersion: current.config.version, baseHash, manifestHash, targetManifestHash: target.hash, testsFingerprint: testFingerprint(current.cases), proposalHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      payload: json({ repeats, base: current.config, proposed, invariant, regressionHash, sourceHash: origin.sourceHash, baseline: previous ? testReportFromRecord(previous) : null }) } });
    await scheduleRepair(tx, id, "start"); return { id };
  }, { timeout: 15_000 });
}
export async function decideRepair(ownerId: string, id: string, input: unknown, deps = runtimeServices() as RuntimeDependencies) {
  const decision = ReviewSchema.parse(input); const found = await ownedRepair(ownerId, id);
  return getDb().$transaction(async tx => {
    const current = await identity(tx, ownerId, found.agentId, deps);
    // Lock the receipt after the agent, matching the apply node's lock order.
    await tx.$queryRaw`SELECT "id" FROM "RepairCase" WHERE "id"=${id} FOR UPDATE`;
    const row = await tx.repairCase.findUniqueOrThrow({ where: { id } }); validateProposal(row);
    if (decision.proposalHash !== row.proposalHash) throw new HttpError(409, "repair_proposal_changed");
    if (row.approved !== null) {
      if (row.approved !== decision.approved || row.reviewerId !== ownerId) throw new HttpError(409, "repair_already_decided");
      return { id };
    }
    if (row.status !== "review" || row.expiresAt <= new Date()) throw new HttpError(409, "repair_review_unavailable");
    if (current.manifest.hash !== row.manifestHash || artifactHash(current.config) !== row.baseHash) throw new HttpError(409, "repair_base_changed");
    await tx.repairCase.update({ where: { id }, data: { approved: decision.approved, reviewerId: ownerId, decidedAt: new Date() } });
    await scheduleRepair(tx, id, "decision"); return { id };
  }, { timeout: 15_000 });
}
export async function cancelRepair(ownerId: string, id: string) {
  await ownedRepair(ownerId, id);
  await getDb().$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "RepairCase" WHERE "id"=${id} FOR UPDATE`;
    const row = await tx.repairCase.findUniqueOrThrow({ where: { id } });
    if (TERMINAL_REPAIRS.includes(row.status)) return;
    await tx.repairCase.update({ where: { id }, data: { status: "cancelled", reason: "cancelled" } });
    if (row.childJobId) await tx.executionJob.updateMany({ where: { id: row.childJobId, ownerId }, data: { cancelRequested: true } });
  });
}
export async function repairView(ownerId: string, id: string) {
  const row = await ownedRepair(ownerId, id); const payload = validateProposal(row);
  const child = row.childJobId ? await getDb().executionJob.findFirst({ where: { id: row.childJobId, ownerId }, select: { status: true, result: true } }) : null;
  return { id: row.id, agentId: row.agentId, sourceRunId: row.sourceRunId, status: row.status, reason: row.reason,
    baseVersion: row.baseVersion, appliedVersion: row.appliedVersion, proposalHash: row.proposalHash, expiresAt: row.expiresAt.toISOString(), expired: row.expiresAt <= new Date(), repeats: payload.repeats,
    before: payload.base.instructions, after: payload.proposed.instructions, baseline: payload.baseline,
    approved: row.approved, child, evaluations: await getDb().executionJob.findMany({ where: { id: { in: row.childJobIds }, ownerId }, select: { id: true, status: true, result: true }, orderBy: { createdAt: "asc" } }), testCaseId: row.testCaseId };
}
