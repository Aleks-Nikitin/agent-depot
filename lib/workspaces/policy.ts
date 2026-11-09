import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { LimitsSchema, type AgentConfig } from "@/lib/agents/contracts";
import { ensureWorkspace } from "@/lib/agents/workspace";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";

export const WorkspacePolicySchema = z.object({
  allowedTools: z.array(z.string().min(1).max(100)).max(30),
  dailyBudgetMicros: z.number().int().min(0).max(1_000_000_000),
  maxConcurrentRuns: z.number().int().min(1).max(100),
  limits: LimitsSchema,
}).strict();
export type WorkspacePolicy = z.infer<typeof WorkspacePolicySchema>;

/** This row lock serializes admission, daily spend and operator policy changes. */
export async function lockedPolicy(tx: Prisma.TransactionClient, ownerId: string, billable = false) {
  await ensureWorkspace(tx, ownerId);
  await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "ownerId"=${ownerId} FOR UPDATE`;
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { ownerId } });
  const policy = WorkspacePolicySchema.parse(workspace.policy);
  const user = await tx.user.findUnique({ where: { id: ownerId }, select: { isAnonymous: true } });
  if (billable && user?.isAnonymous && process.env.NODE_ENV === "production") throw new HttpError(403, "guest_execution_disabled");
  return policy;
}

export function assertNarrowed(config: AgentConfig, policy: WorkspacePolicy) {
  if (config.enabledTools.some(id => !policy.allowedTools.includes(id))) throw new HttpError(403, "workspace_tool_denied");
  for (const key of Object.keys(policy.limits) as (keyof WorkspacePolicy["limits"])[]) {
    if (config.limits[key] > policy.limits[key]) throw new HttpError(403, "workspace_limit_exceeded");
  }
}

export async function assertWorkspaceConfig(config: AgentConfig, billable = true) {
  return getDb().$transaction(async tx => {
    const policy = await lockedPolicy(tx, config.ownerId, billable); assertNarrowed(config, policy); return policy;
  });
}

export async function getWorkspacePolicy(ownerId: string, billable = false) {
  return getDb().$transaction(tx => lockedPolicy(tx, ownerId, billable));
}

export const WORKSPACE_BLOCKS = new Set(["guest_execution_disabled", "workspace_tool_denied", "workspace_limit_exceeded", "workspace_concurrency_limit", "workspace_budget_limit"]);
