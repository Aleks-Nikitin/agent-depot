import { z } from "zod";
import { getDb } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/auth/errors";
import { AgentConfigSchema } from "@/lib/agents/contracts";
import { TestCaseInputSchema } from "@/lib/evals/schema";
import { testFingerprint } from "@/lib/evals/fingerprint";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { getWorkspacePolicy, lockedPolicy, assertNarrowed } from "@/lib/workspaces/policy";
import { GovernancePolicySchema, PackPayloadSchema, organizationMember, assertTeamPolicy, composeGovernance, governanceViolations } from "./policy";
const name = z.string().trim().min(1).max(80);
export const AssignmentSchema = z.object({ expectedVersion: z.number().int().positive(), teamId: z.string().uuid().nullable(), packs: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict()).max(2).refine(p => new Set(p.map(x => x.id)).size === p.length, "Choose one version per pack").default([]) }).strict();
export const SaveAssignmentSchema = AssignmentSchema.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) });
async function admin(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`;
  return organizationMember(tx, organizationId, userId, true);
}
export async function createOrganization(ownerId: string, title: string) {
  const user = await getDb().user.findUnique({ where: { id: ownerId } });
  if (!user || user.isAnonymous) throw new HttpError(403, "registered_account_required");
  if (await getDb().organization.count({ where: { members: { some: { userId: ownerId, role: "owner" } } } }) >= 20) throw new HttpError(409, "organization_limit");
  const base = await getWorkspacePolicy(ownerId);
  const connection = await getDb().gitHubConnection.findUnique({ where: { ownerId }, select: { repository: true, enabled: true } });
  const policy = GovernancePolicySchema.parse({ ...base, allowedProfiles: ["gemini-primary", "openai-fallback"], allowedRepositories: connection?.enabled ? [connection.repository] : [], mandatoryRules: [], requireWriteApproval: true });
  return getDb().organization.create({ data: { name: name.parse(title), policy, members: { create: { userId: ownerId, role: "owner" } } } });
}
export async function createTeam(ownerId: string, organizationId: string, title: string) {
  return getDb().$transaction(async tx => {
    await admin(tx, organizationId, ownerId);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (await tx.team.count({ where: { organizationId } }) >= 30) throw new HttpError(409, "team_limit");
    return tx.team.create({ data: { organizationId, name: name.parse(title), policy: { ...GovernancePolicySchema.parse(org.policy), mandatoryRules: [] } } });
  });
}
export async function updatePolicy(ownerId: string, scope: "organization" | "team", id: string, expectedRevision: number, raw: unknown) {
  const policy = GovernancePolicySchema.parse(raw);
  return getDb().$transaction(async tx => {
    const team = scope === "team" ? await tx.team.findUnique({ where: { id } }) : null;
    if (scope === "team" && !team) throw new HttpError(404, "team_not_found");
    const organizationId = team?.organizationId ?? id;
    await admin(tx, organizationId, ownerId);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if ((team?.revision ?? org.revision) !== expectedRevision) throw new HttpError(409, "governance_policy_changed");
    if (team) { assertTeamPolicy(policy, GovernancePolicySchema.parse(org.policy)); return tx.team.update({ where: { id }, data: { policy, revision: { increment: 1 } } }); }
    return tx.organization.update({ where: { id }, data: { policy, revision: { increment: 1 } } });
  });
}
export async function changeMember(ownerId: string, organizationId: string, raw: unknown) {
  const input = z.object({ email: z.email().max(254), role: z.enum(["member", "admin"]).default("member"), teamId: z.string().uuid().optional(), remove: z.boolean().default(false) }).strict().parse(raw);
  return getDb().$transaction(async tx => {
    await admin(tx, organizationId, ownerId);
    const user = await tx.user.findUnique({ where: { email: input.email } });
    if (!user || user.isAnonymous) throw new HttpError(404, "registered_member_not_found");
    const prior = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } } });
    if (prior?.role === "owner") throw new HttpError(403, "organization_owner_protected");
    if (!prior && !input.remove && await tx.organizationMember.count({ where: { organizationId } }) >= 100) throw new HttpError(409, "organization_member_limit");
    if (input.teamId) {
      const team = await tx.team.findFirst({ where: { id: input.teamId, organizationId } }); if (!team) throw new HttpError(404, "team_not_found");
    }
    if (input.remove && input.teamId) { await tx.teamMember.deleteMany({ where: { teamId: input.teamId, userId: user.id } }); return; }
    if (input.remove) {
      await tx.teamMember.deleteMany({ where: { userId: user.id, team: { organizationId } } });
      await tx.organizationMember.deleteMany({ where: { organizationId, userId: user.id } }); return;
    }
    await tx.organizationMember.upsert({ where: { organizationId_userId: { organizationId, userId: user.id } }, create: { organizationId, userId: user.id, role: input.role }, update: { role: input.role } });
    if (input.teamId) await tx.teamMember.upsert({ where: { teamId_userId: { teamId: input.teamId, userId: user.id } }, create: { teamId: input.teamId, userId: user.id }, update: {} });
  });
}
export async function savePack(ownerId: string, organizationId: string, raw: unknown) {
  const input = z.object({ name, id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(), payload: PackPayloadSchema }).strict().parse(raw);
  if (Buffer.byteLength(JSON.stringify(input.payload)) > 12_000) throw new HttpError(413, "pack_payload_limit");
  return getDb().$transaction(async tx => {
    await admin(tx, organizationId, ownerId);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } }); const policy = GovernancePolicySchema.parse(org.policy);
    if (input.payload.enabledTools.some(t => !policy.allowedTools.includes(t)) || input.payload.modelProfiles.some(p => !policy.allowedProfiles.includes(p))) throw new HttpError(403, "pack_exceeds_organization_policy");
    const old = input.id ? await tx.sharedPack.findFirst({ where: { id: input.id, organizationId } }) : null;
    if (input.id && !old) throw new HttpError(404, "pack_not_found");
    if (old && old.version !== input.expectedVersion) throw new HttpError(409, "pack_version_changed");
    if ((old?.version ?? 0) >= 100 || (!old && await tx.sharedPack.count({ where: { organizationId } }) >= 30)) throw new HttpError(409, "library_pack_limit");
    const pack = old ? await tx.sharedPack.update({ where: { id: old.id }, data: { name: input.name, version: { increment: 1 } } }) : await tx.sharedPack.create({ data: { organizationId, name: input.name } });
    await tx.sharedPackVersion.create({ data: { packId: pack.id, version: pack.version, payload: input.payload as Prisma.InputJsonValue, hash: artifactHash(input.payload), createdBy: ownerId } });
    return pack;
  });
}
async function proposal(tx: Prisma.TransactionClient, ownerId: string, agentId: string, input: z.infer<typeof AssignmentSchema>) {
  const row = await tx.agent.findFirst({ where: { id: agentId, ownerId } }); if (!row) throw new HttpError(404, "agent_not_found");
  if (row.version !== input.expectedVersion) throw new HttpError(409, "agent_version_changed");
  const base = AgentConfigSchema.parse(row.config);
  if (row.teamId && row.teamId !== input.teamId) {
    const old = await tx.team.findUnique({ where: { id: row.teamId } }); if (!old) throw new HttpError(403, "governance_team_unavailable");
    await organizationMember(tx, old.organizationId, ownerId, true);
  }
  if (!input.teamId && input.packs.length) throw new HttpError(400, "pack_requires_team");
  const { governance, ...rest } = base; void governance;
  let config = AgentConfigSchema.parse({ ...rest, version: row.version + 1 });
  const scenarios: z.infer<typeof TestCaseInputSchema>[] = [];
  if (input.teamId) {
    const team = await tx.team.findUnique({ where: { id: input.teamId } }); if (!team) throw new HttpError(404, "team_not_found");
    const org = await tx.organization.findUniqueOrThrow({ where: { id: team.organizationId } });
    const refs = [];
    const tools = new Set(base.enabledTools);
    for (const pack of input.packs) {
      const version = await tx.sharedPackVersion.findUnique({ where: { packId_version: { packId: pack.id, version: pack.version } }, include: { pack: true } });
      if (!version || version.pack.organizationId !== org.id || artifactHash(version.payload) !== version.hash) throw new HttpError(404, "pack_not_found");
      const payload = PackPayloadSchema.parse(version.payload); payload.enabledTools.forEach(t => tools.add(t)); scenarios.push(...payload.scenarios);
      refs.push({ ...pack, hash: version.hash });
    }
    config = AgentConfigSchema.parse({ ...config, enabledTools: [...tools], governance: { teamId: team.id, organizationRevision: org.revision, teamRevision: team.revision, packs: refs } });
  }
  let policy = await composeGovernance(tx, config, await lockedPolicy(tx, ownerId), true);
  // Automatic changes only tighten ceilings and review requirements. Model choices
  // and resource grants are never silently substituted.
  config = { ...config, limits: Object.fromEntries(Object.entries(config.limits).map(([k, v]) => [k, Math.min(v, policy.limits[k as keyof typeof policy.limits])])) as typeof config.limits,
    requireWriteApproval: config.requireWriteApproval || !!policy.governance?.requireWriteApproval };
  policy = await composeGovernance(tx, config, await lockedPolicy(tx, ownerId), true);
  const existing = (await tx.testCase.findMany({ where: { agentId } })).map(t => TestCaseInputSchema.parse({ input: t.input, mustCall: t.mustCall, mustNotCall: t.mustNotCall, mustContain: t.mustContain, useGrader: t.useGrader, expectedBehavior: t.expectedBehavior ?? undefined, source: t.source, fixtures: t.fixtures, stateAssertions: t.stateAssertions }));
  const caseHash = (t: z.infer<typeof TestCaseInputSchema>) => testFingerprint([{ ...t, id: "shared-definition" }]);
  const hashes = new Set(existing.map(caseHash));
  const added = scenarios.filter(t => { const hash = caseHash(t); if (hashes.has(hash)) return false; hashes.add(hash); return true; });
  const violations = governanceViolations(config, policy);
  if (existing.length + added.length > 5) violations.push({ field: "scenarios", requested: existing.length + added.length, permitted: 5, sources: ["Evaluation suite limit"] });
  const diff = { toolsBefore: base.enabledTools, toolsAfter: config.enabledTools, limitsBefore: base.limits, limitsAfter: config.limits, requireWriteApproval: config.requireWriteApproval, addedScenarios: added.length,
    provenance: policy.governance ?? null, violations };
  return { config, policy, added, diff, previewHash: artifactHash({ baseVersion: base.version, config, diff, added }) };
}
export async function previewAssignment(ownerId: string, agentId: string, raw: unknown) {
  return getDb().$transaction(async tx => { const p = await proposal(tx, ownerId, agentId, AssignmentSchema.parse(raw)); return { diff: p.diff, previewHash: p.previewHash }; });
}
export async function saveAssignment(ownerId: string, agentId: string, raw: unknown) {
  const input = SaveAssignmentSchema.parse(raw);
  return getDb().$transaction(async tx => {
    const locked = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 0 } } }); if (!locked.count) throw new HttpError(404, "agent_not_found");
    const p = await proposal(tx, ownerId, agentId, AssignmentSchema.parse({ expectedVersion: input.expectedVersion, teamId: input.teamId, packs: input.packs }));
    if (p.previewHash !== input.previewHash) throw new HttpError(409, "permission_preview_changed");
    if (p.diff.violations.length) throw new HttpError(403, "governance_policy_denied");
    assertNarrowed(p.config, p.policy);
    await tx.agent.update({ where: { id: agentId }, data: { config: p.config, teamId: input.teamId, version: p.config.version, testRevision: { increment: p.added.length ? 1 : 0 } } });
    await tx.agentDraft.create({ data: { agentId, version: p.config.version, name: p.config.name, config: p.config } });
    if (p.added.length) await tx.testCase.createMany({ data: p.added.map(t => ({ ...t, agentId })) });
    return { version: p.config.version };
  });
}
export async function governanceView(ownerId: string) {
  const organizations = await getDb().organization.findMany({ where: { members: { some: { userId: ownerId } } }, orderBy: { createdAt: "asc" }, take: 20,
    include: { members: { take: 100, select: { userId: true, role: true } }, teams: { take: 30, include: { members: { take: 100, select: { userId: true } } } }, packs: { take: 30, include: { versions: { orderBy: { version: "desc" }, take: 10 } } } } });
  return { organizations: organizations.map(o => ({ id: o.id, name: o.name, revision: o.revision, policy: GovernancePolicySchema.parse(o.policy),
    role: o.members.find(m => m.userId === ownerId)!.role, members: o.members,
    teams: o.teams.filter(t => o.members.find(m => m.userId === ownerId)!.role !== "member" || t.members.some(m => m.userId === ownerId)).map(t => ({ id: t.id, name: t.name, revision: t.revision, policy: GovernancePolicySchema.parse(t.policy) })),
    packs: o.packs.map(p => ({ id: p.id, name: p.name, version: p.version, versions: p.versions.map(v => ({ version: v.version, hash: v.hash, payload: PackPayloadSchema.parse(v.payload) })) })) })) };
}
