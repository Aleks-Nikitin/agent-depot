import { getDb } from "@/lib/db/prisma";
import { AgentConfigSchema } from "../contracts";
import { HttpError } from "@/lib/auth/errors";
import { artifactHash } from "./fingerprint";
import { ProviderSettingsSchema } from "./provider-settings";
import type { AgentRelease } from "@/generated/prisma/client";

export function releaseArtifact(row: AgentRelease, ownerId: string, agentId: string) {
  const config = AgentConfigSchema.parse(row.config);
  const providerSettings = ProviderSettingsSchema.parse(row.providerSettings);
  if (row.agentId !== agentId || config.id !== agentId || config.ownerId !== ownerId || config.version !== row.version
    || artifactHash(config) !== row.configHash
    || artifactHash({ configHash: row.configHash, providerSettings, evidence: row.evidence }) !== row.evidenceHash) {
    throw new HttpError(409, "release_artifact_mismatch");
  }
  return { config, providerSettings, releaseId: row.id, draftId: row.draftId };
}

export async function resolveServingRelease(ownerId: string, agentId: string) {
  const agent = await getDb().agent.findFirst({ where: { id: agentId, ownerId }, include: { servingRelease: true } });
  if (!agent) throw new Error("agent_not_found");
  if (!agent.servingRelease) throw new HttpError(409, "no_serving_release");
  return releaseArtifact(agent.servingRelease, ownerId, agentId);
}

export async function resolveDraft(ownerId: string, agentId: string, version?: number) {
  const agent = await getDb().agent.findFirst({ where: { id: agentId, ownerId } });
  if (!agent) throw new Error("agent_not_found");
  const draft = await getDb().agentDraft.findUnique({ where: { agentId_version: { agentId, version: version ?? agent.version } } });
  if (!draft) throw new HttpError(404, "draft_not_found");
  const config = AgentConfigSchema.parse(draft.config);
  if (config.id !== agentId || config.ownerId !== ownerId || config.version !== draft.version) throw new Error("invalid_agent_record");
  return { config, draftId: draft.id };
}
