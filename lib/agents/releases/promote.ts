import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { readPublishStatus } from "@/lib/evals/publish-gate";
import { AgentConfigSchema } from "../contracts";
import { artifactHash } from "./fingerprint";
import { ProviderSettingsSchema } from "./provider-settings";
import { releaseArtifact } from "./resolve";

export async function promoteRelease(ownerId: string, agentId: string, expectedVersion?: number) {
  return getDb().$transaction(async tx => {
    // Same row lock as draft saves, suite starts and test-case mutations.
    const locked = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 0 } } });
    if (locked.count !== 1) throw new Error("agent_not_found");
    const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
    if (expectedVersion !== undefined && expectedVersion !== agent.version) throw new HttpError(409, "draft_changed");
    const status = await readPublishStatus(tx, ownerId, agentId);
    if (!status.canPublish) throw new Error("tests_not_passed");
    const draft = await tx.agentDraft.findUniqueOrThrow({ where: { agentId_version: { agentId, version: agent.version } } });
    const config = AgentConfigSchema.parse(draft.config);
    if (artifactHash(config) !== artifactHash(AgentConfigSchema.parse(agent.config))) throw new HttpError(409, "draft_changed");
    const run = await tx.testRun.findFirstOrThrow({ where: { agentId, agentVersion: agent.version }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const providerSettings = ProviderSettingsSchema.parse(run.providerSettings);
    const evidence = { testRunId: run.id, testsFingerprint: run.testsFingerprint, results: run.results,
      passedCount: run.passedCount, totalCount: run.totalCount, finishedAt: run.finishedAt!.toISOString() };
    const configHash = artifactHash(config);
    const evidenceHash = artifactHash({ configHash, providerSettings, evidence });
    // Repeated publication of identical evidence returns the same approved artifact.
    const existing = await tx.agentRelease.findFirst({ where: { agentId, evidenceHash } });
    const release = existing ?? await tx.agentRelease.create({ data: {
      agentId, draftId: draft.id, version: draft.version, config, configHash, providerSettings,
      evidence: JSON.parse(JSON.stringify(evidence)), evidenceHash, approvedBy: ownerId,
    } });
    await tx.agent.update({ where: { id: agentId }, data: { servingReleaseId: release.id,
      servingGeneration: { increment: 1 }, published: true, publishedVersion: release.version } });
    return release;
  });
}

export async function rollbackRelease(ownerId: string, agentId: string, releaseId: string, expectedGeneration: number) {
  return getDb().$transaction(async tx => {
    const locked = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 0 } } });
    if (locked.count !== 1) throw new Error("agent_not_found");
    const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
    if (agent.servingGeneration !== expectedGeneration) throw new HttpError(409, "serving_release_changed");
    const release = await tx.agentRelease.findFirst({ where: { id: releaseId, agentId } });
    if (!release) throw new HttpError(404, "release_not_found");
    releaseArtifact(release, ownerId, agentId);
    await tx.agent.update({ where: { id: agentId }, data: { servingReleaseId: release.id,
      servingGeneration: { increment: 1 }, published: true, publishedVersion: release.version } });
    return { releaseId: release.id, version: release.version };
  });
}
