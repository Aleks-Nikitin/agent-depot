import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AgentConfigSchema, LimitsSchema, type AgentConfig } from "@/lib/agents/contracts";
import { modelProfileId, ModelProfileIdSchema } from "@/lib/agents/profiles";
import { TestCaseInputSchema } from "@/lib/evals/schema";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { HttpError } from "@/lib/auth/errors";
import type { WorkspacePolicy } from "@/lib/workspaces/policy";

export const GovernancePolicySchema = z.object({
  allowedTools: z.array(z.string().min(1).max(100)).max(30), allowedProfiles: z.array(ModelProfileIdSchema).min(1).max(2),
  allowedRepositories: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/)).max(30),
  limits: LimitsSchema, dailyBudgetMicros: z.number().int().min(0).max(1_000_000_000), maxConcurrentRuns: z.number().int().min(1).max(100),
  mandatoryRules: z.array(z.string().trim().min(1).max(500)).max(5), requireWriteApproval: z.boolean(),
}).strict();
export type GovernancePolicy = z.infer<typeof GovernancePolicySchema>;
export const PackPayloadSchema = z.object({ instructions: z.string().trim().max(2000),
  modelProfiles: z.array(ModelProfileIdSchema).min(1).max(2), enabledTools: z.array(z.string().min(1).max(100)).max(10),
  scenarios: z.array(TestCaseInputSchema).max(5) }).strict();
export type GovernanceReader = Pick<Prisma.TransactionClient, "agent" | "team" | "organization" | "organizationMember" | "teamMember" | "sharedPackVersion" | "$queryRaw">;
export async function organizationMember(db: GovernanceReader, organizationId: string, userId: string, admin = false) {
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (!member || (admin && !["owner", "admin"].includes(member.role))) throw new HttpError(403, "organization_access_denied");
  return member;
}
export function assertTeamPolicy(team: GovernancePolicy, org: GovernancePolicy) {
  const subset = (a: string[], b: string[]) => a.every(v => b.includes(v));
  if (!subset(team.allowedTools, org.allowedTools) || !subset(team.allowedProfiles, org.allowedProfiles)
    || !subset(team.allowedRepositories, org.allowedRepositories) || team.dailyBudgetMicros > org.dailyBudgetMicros
    || team.maxConcurrentRuns > org.maxConcurrentRuns || (org.requireWriteApproval && !team.requireWriteApproval)
    || Object.keys(org.limits).some(k => team.limits[k as keyof typeof org.limits] > org.limits[k as keyof typeof org.limits])) throw new HttpError(403, "team_policy_must_narrow");
}
export async function composeGovernance(db: GovernanceReader, config: AgentConfig, workspace: WorkspacePolicy, assignment = false): Promise<WorkspacePolicy> {
  const current = await db.agent.findUnique({ where: { id: config.id }, select: { teamId: true, ownerId: true } });
  if ((current?.teamId || config.governance) && current && current.ownerId !== config.ownerId) throw new HttpError(403, "governance_assignment_changed");
  if (!assignment && current && current.teamId !== (config.governance?.teamId ?? null)) throw new HttpError(403, "governance_assignment_changed");
  if (!config.governance) return workspace;
  const pin = config.governance;
  const initialTeam = await db.team.findUnique({ where: { id: pin.teamId } });
  if (!initialTeam) throw new HttpError(403, "governance_team_unavailable");
  // Policy edits and membership changes lock the same organization row.
  await db.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${initialTeam.organizationId} FOR SHARE`;
  const team = await db.team.findUnique({ where: { id: pin.teamId } });
  if (!team || team.organizationId !== initialTeam.organizationId) throw new HttpError(403, "governance_team_unavailable");
  const member = await organizationMember(db, team.organizationId, config.ownerId);
  if (member.role === "member" && !await db.teamMember.findUnique({ where: { teamId_userId: { teamId: team.id, userId: config.ownerId } } })) throw new HttpError(403, "team_access_denied");
  const org = await db.organization.findUniqueOrThrow({ where: { id: team.organizationId } });
  if (org.revision !== pin.organizationRevision || team.revision !== pin.teamRevision) throw new HttpError(409, "governance_policy_changed");
  const policies = [GovernancePolicySchema.parse(org.policy), GovernancePolicySchema.parse(team.policy)];
  const intersection = (a: string[], b: string[]) => a.filter(value => b.includes(value));
  let allowedTools = [...workspace.allowedTools], allowedProfiles = [...ModelProfileIdSchema.options] as string[];
  let allowedRepositories = [...policies[0].allowedRepositories];
  const limits = { ...workspace.limits }; let dailyBudgetMicros = workspace.dailyBudgetMicros, maxConcurrentRuns = workspace.maxConcurrentRuns;
  const mandatoryRules: string[] = []; let requireWriteApproval = false;
  for (const policy of policies) {
    allowedTools = intersection(allowedTools, policy.allowedTools); allowedProfiles = intersection(allowedProfiles, policy.allowedProfiles);
    allowedRepositories = intersection(allowedRepositories, policy.allowedRepositories); mandatoryRules.push(...policy.mandatoryRules);
    requireWriteApproval ||= policy.requireWriteApproval;
    dailyBudgetMicros = Math.min(dailyBudgetMicros, policy.dailyBudgetMicros); maxConcurrentRuns = Math.min(maxConcurrentRuns, policy.maxConcurrentRuns);
    for (const k of Object.keys(limits) as (keyof typeof limits)[]) limits[k] = Math.min(limits[k], policy.limits[k]);
  }
  for (const ref of pin.packs) {
    const version = await db.sharedPackVersion.findUnique({ where: { packId_version: { packId: ref.id, version: ref.version } }, include: { pack: true } });
    if (!version || version.pack.organizationId !== org.id || version.hash !== ref.hash || artifactHash(version.payload) !== ref.hash) throw new HttpError(409, "library_pack_changed");
    const payload = PackPayloadSchema.parse(version.payload); if (payload.instructions) mandatoryRules.push(payload.instructions);
    allowedProfiles = intersection(allowedProfiles, payload.modelProfiles);
  }
  return { ...workspace, allowedTools, limits, dailyBudgetMicros, maxConcurrentRuns,
    governance: { organizationId: org.id, organizationName: org.name, organizationRevision: org.revision, teamId: team.id, teamName: team.name, teamRevision: team.revision,
      allowedProfiles: ModelProfileIdSchema.array().parse(allowedProfiles), allowedRepositories, mandatoryRules, requireWriteApproval, packs: pin.packs } };
}
export function governanceViolations(config: AgentConfig, policy: WorkspacePolicy) {
  const sources = policy.governance ? [`Organization: ${policy.governance.organizationName} v${policy.governance.organizationRevision}`, `Team: ${policy.governance.teamName} v${policy.governance.teamRevision}`, "Workspace policy"] : ["Workspace policy"];
  const fields: { field: string; requested: unknown; permitted: unknown; sources: string[] }[] = [];
  for (const tool of config.enabledTools) if (!policy.allowedTools.includes(tool)) fields.push({ field: `enabledTools.${tool}`, requested: true, permitted: false, sources });
  for (const k of Object.keys(policy.limits) as (keyof typeof policy.limits)[]) if (config.limits[k] > policy.limits[k]) fields.push({ field: `limits.${k}`, requested: config.limits[k], permitted: policy.limits[k], sources });
  if (policy.governance) {
    const profiles = [modelProfileId(config), config.fallbackModelProfile ?? process.env.RUNTIME_FALLBACK_PROFILE, ...(config.routing?.approvedProfiles ?? [])].filter((p): p is string => !!p);
    for (const profile of profiles) if (!policy.governance.allowedProfiles.includes(profile as z.infer<typeof ModelProfileIdSchema>)) fields.push({ field: "modelProfile", requested: profile, permitted: policy.governance.allowedProfiles, sources });
    if (config.github && !policy.governance.allowedRepositories.includes(config.github.repository ?? "")) fields.push({ field: "github.repository", requested: config.github.repository ?? "unspecified", permitted: policy.governance.allowedRepositories, sources });
    if (policy.governance.requireWriteApproval && !config.requireWriteApproval) fields.push({ field: "requireWriteApproval", requested: false, permitted: true, sources });
  }
  return fields;
}
export function governanceInstructions(config: AgentConfig, policy: WorkspacePolicy) {
  AgentConfigSchema.parse(config);
  return policy.governance?.mandatoryRules.length ? config.instructions + "\n\nMandatory organization, team and pinned-library instructions:\n" + policy.governance.mandatoryRules.join("\n\n") : config.instructions;
}
