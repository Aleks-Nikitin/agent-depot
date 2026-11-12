import { z } from "zod";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { AgentConfigSchema } from "@/lib/agents/contracts";
import { assertNarrowed, lockedPolicy } from "@/lib/workspaces/policy";
import { GITHUB_TOOLS } from "./contracts";
import { connectionSummary } from "./github";

export const SaveGitHubBindingSchema = z.object({ expectedVersion: z.number().int().positive(), read: z.boolean(), write: z.boolean() }).strict();
export async function saveGitHubBinding(ownerId: string, agentId: string, raw: unknown) {
  const input = SaveGitHubBindingSchema.parse(raw);
  return getDb().$transaction(async tx => {
    const locked = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 0 } } });
    if (!locked.count) throw new HttpError(404, "agent_not_found");
    const row = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
    if (row.version !== input.expectedVersion) throw new HttpError(409, "agent_version_changed");
    const policy = await lockedPolicy(tx, ownerId);
    const connection = await tx.gitHubConnection.findUnique({ where: { ownerId } });
    if ((input.read || input.write) && (!connection?.enabled || (input.write && !connection.allowWrites))) throw new HttpError(409, "connector_not_connected");
    const { github, ...base } = AgentConfigSchema.parse(row.config); void github;
    const config = AgentConfigSchema.parse({ ...base, version: row.version + 1,
      enabledTools: [...base.enabledTools.filter(t => !GITHUB_TOOLS.includes(t as typeof GITHUB_TOOLS[number])), ...(input.read ? [GITHUB_TOOLS[0]] : []), ...(input.write ? [GITHUB_TOOLS[1]] : [])],
      ...((input.read || input.write) && connection ? { github: { connectionId: connection.id, revision: connection.revision, repository: connection.repository } } : {}),
    });
    assertNarrowed(config, policy);
    await tx.agent.update({ where: { id: agentId }, data: { config, version: config.version } });
    await tx.agentDraft.create({ data: { agentId, version: config.version, name: config.name, config } });
    return { version: config.version };
  });
}
export async function agentGitHubView(ownerId: string, agentId: string) {
  const row = await getDb().agent.findFirst({ where: { id: agentId, ownerId } });
  if (!row) throw new HttpError(404, "agent_not_found");
  const config = AgentConfigSchema.parse(row.config);
  const connection = await connectionSummary(ownerId);
  return { agentId, version: config.version, read: config.enabledTools.includes(GITHUB_TOOLS[0]), write: config.enabledTools.includes(GITHUB_TOOLS[1]),
    connection, bindingCurrent: !!connection?.enabled && config.github?.connectionId === connection.id && config.github?.revision === connection.revision };
}
