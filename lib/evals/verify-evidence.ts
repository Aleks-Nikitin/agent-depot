import type { Prisma } from "@/generated/prisma/client";
import { AgentConfigSchema } from "@/lib/agents/contracts";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { captureProviderSettings } from "@/lib/agents/releases/provider-settings";
import { CheckpointSchema } from "@/lib/agents/runtime/state";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import { EvaluationManifestSchema, buildEvaluationManifest, evaluationKnowledge } from "./manifest";
import { normalizedSnapshot, fixtureSnapshot } from "./state/check";
import { StateEvidenceSchema, stateEvidence } from "./state/evidence";
import { WorkspacePolicySchema, assertNarrowed } from "@/lib/workspaces/policy";

export async function verifyOutcomeEvidence(db: Pick<Prisma.TransactionClient, "evaluationManifest" | "knowledgeDocument" | "agentRun" | "workspace">, config: ReturnType<typeof AgentConfigSchema.parse>, cases: { id: string }[], run: { id: string }, results: { testCaseId: string; response: string | null; runId: string | null; stateEvidence?: unknown }[]) {
  try {
    const saved = await db.evaluationManifest.findUnique({ where: { testRunId: run.id } });
    if (!saved || !EvaluationManifestSchema.safeParse(saved.payload).success || artifactHash(saved.payload) !== saved.hash) return false;
    const workspacePolicy = WorkspacePolicySchema.parse((await db.workspace.findUniqueOrThrow({ where: { ownerId: config.ownerId } })).policy);
    assertNarrowed(config, workspacePolicy);
    const current = buildEvaluationManifest({ config, cases, workspacePolicy, providerSettings: captureProviderSettings(config), knowledge: await evaluationKnowledge(db, config.ownerId, config.id), registry: runtimeRegistry });
    if (current.hash !== saved.hash) return false;
    const ids = results.map(result => result.runId).filter((id): id is string => !!id);
    if (new Set(ids).size !== cases.length) return false;
    const sources = await db.agentRun.findMany({ where: { id: { in: ids }, ownerId: config.ownerId, agentId: config.id, agentVersion: config.version, source: "test", status: "completed", finishedAt: { not: null } } });
    if (sources.length !== cases.length) return false;
    for (const { test, fixtures } of current.resolved) {
      const result = results.find(result => result.testCaseId === test.id);
      if (!result?.runId) return false;
      const parsed = StateEvidenceSchema.safeParse(result.stateEvidence);
      if (!parsed.success) return false;
      const source = sources.find(source => source.id === result.runId);
      if (!source || source.response !== result.response) return false;
      const sourceConfig = AgentConfigSchema.parse(source.configSnapshot);
      if (artifactHash({ ...sourceConfig, limits: config.limits }) !== artifactHash(config)
        || sourceConfig.limits.timeoutMs > Math.min(config.limits.timeoutMs, 30_000)
        || sourceConfig.limits.maxEstimatedCostUsd > Math.min(config.limits.maxEstimatedCostUsd, 0.02)) return false;
      const checkpoint = CheckpointSchema.parse(source.checkpoint);
      if (checkpoint.domainScope?.kind !== "evaluation" || checkpoint.domainScope.ownerId !== config.ownerId
        || checkpoint.domainScope.knowledgeHash !== artifactHash(fixtures.knowledge)) return false;
      const expected = stateEvidence({ ownerId: config.ownerId, manifestHash: saved.hash, test, runId: result.runId, sourceCompleted: true,
        before: fixtureSnapshot(fixtures, config.ownerId), after: normalizedSnapshot(parsed.data.after) });
      if (!expected.passed || artifactHash(parsed.data) !== artifactHash(expected)) return false;
    }
    return true;
  } catch { return false; }
}
