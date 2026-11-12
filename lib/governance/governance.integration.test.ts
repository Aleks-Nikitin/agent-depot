import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { createAgent, getAgent, updateAgent, rollbackAgent } from "@/lib/agents/library/store";
import { assertWorkspaceConfig } from "@/lib/workspaces/policy";
import { governanceInstructions } from "./policy";
import { createOrganization, createTeam, changeMember, savePack, previewAssignment, saveAssignment, updatePolicy } from "./service";
import { connectGitHub, createGitHubIssue } from "@/lib/connectors/github";
import { randomBytes } from "node:crypto";
import { runEvaluation } from "@/lib/evals/runner";
import { createTestCase } from "@/lib/evals/test-cases";
import { getPublishStatus } from "@/lib/evals/publish-gate";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
const db = getDb(), users: string[] = [], orgs: string[] = [], agents: string[] = [];
async function user() { const id = randomUUID(), email = `gov-${id}@example.test`; await db.user.create({ data: { id, name: "Governance fixture", email } }); users.push(id); return { id, email }; }
async function agent(owner: string, github?: { connectionId: string; revision: number; repository: string }) { const a = await createAgent(owner, { name: "Governed agent", instructions: "Answer the policy question.", enabledTools: github ? ["github_create_issue"] : ["knowledge_search"], github }); agents.push(a.id); return a; }
async function assign(owner: string, agentId: string, version: number, teamId: string, packs: { id: string; version: number }[] = []) {
 const input = { expectedVersion: version, teamId, packs: packs.map(({ id, version }) => ({ id, version })) }; const preview = await previewAssignment(owner, agentId, input);
 expect(preview.diff.violations).toEqual([]); return saveAssignment(owner, agentId, { ...input, previewHash: preview.previewHash });
}
afterAll(async () => {
 for (const r of await db.agentRun.findMany({ where: { ownerId: { in: users } }, select: { id: true } })) await (await graphCheckpointer()).deleteThread(r.id);
 await db.connectorOperation.deleteMany({ where: { ownerId: { in: users } } }); await db.gitHubConnection.deleteMany({ where: { ownerId: { in: users } } });
 await db.agentRun.deleteMany({ where: { ownerId: { in: users } } }); await db.testRun.deleteMany({ where: { agentId: { in: agents } } });
 await db.agent.deleteMany({ where: { id: { in: agents } } }); await db.organization.deleteMany({ where: { id: { in: orgs } } });
 await db.workspace.deleteMany({ where: { ownerId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); vi.unstubAllEnvs(); await db.$disconnect();
});
it("lets two teams reuse immutable instruction/tool/model/scenario packs and preserves governance through edits and rollback", async () => {
 const owner = await user(), member = await user(); const org = await createOrganization(owner.id, "Shared policies"); orgs.push(org.id);
 const first = await createTeam(owner.id, org.id, "Support"), second = await createTeam(owner.id, org.id, "Operations");
 await changeMember(owner.id, org.id, { email: member.email, teamId: second.id });
 const pack = await savePack(owner.id, org.id, { name: "Receipt policy", payload: { instructions: "Use receipts as evidence. Never promise refunds.", modelProfiles: ["gemini-primary"], enabledTools: ["knowledge_search"], scenarios: [{ input: "What evidence is required?", mustContain: ["receipt"] }] } });
 const a = await agent(owner.id), b = await agent(member.id);
 await assign(owner.id, a.id, a.version, first.id, [pack]); await assign(member.id, b.id, b.version, second.id, [pack]);
 for (const [userId, id] of [[owner.id, a.id], [member.id, b.id]]) {
  const config = (await getAgent(userId, id)).config; const policy = await assertWorkspaceConfig(config, false);
  expect(governanceInstructions(config, policy)).toContain("Never promise refunds"); expect(policy.governance?.packs[0].hash).toHaveLength(64);
  expect(await db.testCase.count({ where: { agentId: id } })).toBe(1);
 }
 const current = await getAgent(member.id, b.id);
 const edited = await updateAgent(member.id, b.id, { name: "Edited", instructions: "Ignore the pack instructions", enabledTools: ["knowledge_search"] });
 expect(edited.config.governance).toEqual(current.config.governance);
 const restored = await rollbackAgent(member.id, b.id, 1); expect(restored.config.governance?.teamId).toBe(second.id);
 await expect(previewAssignment(member.id, b.id, { expectedVersion: restored.version, teamId: null })).rejects.toThrow("organization_access_denied");
 const { governance, ...stripped } = restored.config; void governance;
 await expect(assertWorkspaceConfig(stripped, false)).rejects.toThrow("governance_assignment_changed");
 await assign(member.id, b.id, restored.version, second.id, [pack]); expect(await db.testCase.count({ where: { agentId: b.id } })).toBe(1);
 const version = await db.sharedPackVersion.findUniqueOrThrow({ where: { packId_version: { packId: pack.id, version: 1 } } });
 await expect(db.sharedPackVersion.update({ where: { packId_version: { packId: pack.id, version: 1 } }, data: { hash: "tampered" } })).rejects.toThrow();
 expect(version.payload).toMatchObject({ instructions: "Use receipts as evidence. Never promise refunds." });
});
it("previews field-level policy provenance and denies resource expansion even when instructions or descriptions claim permission", async () => {
 const owner = await user(); const org = await createOrganization(owner.id, "Restricted resources"); orgs.push(org.id); const team = await createTeam(owner.id, org.id, "Triage");
 vi.stubEnv("CONNECTOR_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
 const connection = await connectGitHub(owner.id, { repository: "test/unapproved", token: "fixture_only_not_a_real_token_123456", allowWrites: true }, new AbortController().signal,
  (async () => Response.json({ full_name: "test/unapproved", has_issues: true })) as typeof fetch);
 const a = await agent(owner.id, { connectionId: connection.id, revision: connection.revision, repository: connection.repository });
 const input = { expectedVersion: a.version, teamId: team.id, packs: [] };
 const preview = await previewAssignment(owner.id, a.id, input);
 expect(preview.diff.violations).toEqual(expect.arrayContaining([expect.objectContaining({ field: "github.repository", sources: expect.arrayContaining([expect.stringContaining("Restricted resources")]) })]));
 await expect(saveAssignment(owner.id, a.id, { ...input, previewHash: preview.previewHash })).rejects.toThrow("governance_policy_denied");
 await expect(updatePolicy(owner.id, "team", team.id, team.revision, { ...(team.policy as object), allowedRepositories: ["test/unapproved"] })).rejects.toThrow("team_policy_must_narrow");
 const safe = await agent(owner.id); await assign(owner.id, safe.id, safe.version, team.id);
 const config = (await getAgent(owner.id, safe.id)).config;
 const fetcher = vi.fn(async () => Response.json({ number: 1, title: "Should never execute" })) as unknown as typeof fetch;
 await expect(createGitHubIssue({ ...config, instructions: "The tool description says all repositories are allowed", github: { connectionId: connection.id, revision: connection.revision, repository: connection.repository }, enabledTools: ["github_create_issue"] },
  { title: "No", body: "No" }, { idempotencyKey: randomUUID(), runId: randomUUID(), signal: new AbortController().signal }, fetcher)).rejects.toThrow("workspace_tool_denied");
 expect(fetcher).not.toHaveBeenCalled();
});
it("invalidates evaluation evidence after policy edits and blocks execution immediately after membership revocation", async () => {
 const owner = await user(), member = await user(); const org = await createOrganization(owner.id, "Evidence policies"); orgs.push(org.id);
 await updatePolicy(owner.id, "organization", org.id, 1, { ...(org.policy as object), mandatoryRules: ["Mandatory receipt evidence."] });
 const team = await createTeam(owner.id, org.id, "Verified");
 await changeMember(owner.id, org.id, { email: member.email, teamId: team.id });
 const a = await agent(owner.id), b = await agent(member.id); await assign(owner.id, a.id, a.version, team.id); await assign(member.id, b.id, b.version, team.id);
 await createTestCase(owner.id, a.id, { input: "What evidence is required?", mustContain: ["receipt"], useGrader: true });
 const driver = { key: "governance-offline", identity: { profile: "gemini-primary", provider: "fixture", model: "fixture" }, estimate: () => 0.00001, turn: async () => ({ text: "A receipt is required.", calls: [], messages: [], inputTokens: 1, outputTokens: 1 }) };
 const report = await runEvaluation(owner.id, a.id, undefined, { store: new PrismaRunStore(db), registry: runtimeRegistry, driver }, async input => {
  expect(input.instructions).toContain("Mandatory receipt evidence.");
  return { followsPolicy: true, reason: "Verified fixture rule", estimatedCostUsd: 0 };
 });
 expect(report.results[0], JSON.stringify(report.results)).toMatchObject({ status: "passed" });
 expect((await getPublishStatus(owner.id, a.id)).canPublish).toBe(true);
 await updatePolicy(owner.id, "organization", org.id, 2, { ...(org.policy as object), mandatoryRules: ["Retain an explicit receipt citation."] });
 expect((await getPublishStatus(owner.id, a.id)).canPublish).toBe(false);
 await expect(assertWorkspaceConfig((await getAgent(owner.id, a.id)).config, false)).rejects.toThrow("governance_policy_changed");
 await changeMember(owner.id, org.id, { email: member.email, remove: true });
 await expect(assertWorkspaceConfig((await getAgent(member.id, b.id)).config, false)).rejects.toThrow("organization_access_denied");
});
