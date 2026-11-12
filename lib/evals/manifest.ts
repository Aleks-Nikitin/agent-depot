import { z } from "zod";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import type { AgentConfig } from "@/lib/agents/contracts";
import type { ProviderSettings } from "@/lib/agents/releases/provider-settings";
import type { ToolRegistry } from "@/lib/agents/tools/registry";
import type { Prisma } from "@/generated/prisma/client";
import { knowledgeDocs } from "@/lib/integrations/data/knowledge";
import { EvaluationFixturesSchema } from "./isolation/fixtures";
import { testFingerprint } from "./fingerprint";
import { effectiveAssertions, fixtureSnapshot } from "./state/check";
import { TestCaseInputSchema } from "./schema";

// Bump these declarations when tool effects or runtime/assertion policy semantics change.
export const EVALUATION_POLICY_REVISION = "external-tools-v3";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const EvaluationManifestSchema = z.object({
  version: z.literal(1), agentId: z.string(), ownerId: z.string(), agentVersion: z.number().int(),
  draftHash: digest, testsFingerprint: digest, policyHash: digest, toolsHash: digest, providerHash: digest, knowledgeHash: digest,
  cases: z.array(z.object({ id: z.string(), fixturesHash: digest, assertionsHash: digest }).strict()).min(1).max(5),
}).strict();
export type EvaluationManifest = z.infer<typeof EvaluationManifestSchema>;
export async function evaluationKnowledge(db: Pick<Prisma.TransactionClient, "knowledgeDocument">, ownerId: string) {
  const documents = await db.knowledgeDocument.findMany({ where: { ownerId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100, select: { id: true, title: true, text: true } });
  return { documents: documents.length ? documents : structuredClone(knowledgeDocs), sample: documents.length === 0 };
}
export function buildEvaluationManifest(options: { config: AgentConfig; cases: { id: string }[]; knowledge: Awaited<ReturnType<typeof evaluationKnowledge>>; providerSettings: ProviderSettings; registry: ToolRegistry; workspacePolicy?: unknown }) {
  const { config, knowledge, providerSettings, registry } = options;
  const cases = options.cases.map(row => {
    const value = row as { id: string } & Record<string, unknown>;
    return { ...TestCaseInputSchema.parse({ input: value.input, mustCall: value.mustCall, mustNotCall: value.mustNotCall,
      mustContain: value.mustContain, useGrader: value.useGrader, expectedBehavior: value.expectedBehavior ?? undefined,
      source: value.source, fixtures: value.fixtures, stateAssertions: value.stateAssertions }), id: row.id };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const tools = [...new Set(config.enabledTools)].sort().map(id => {
    const tool = registry.get(id);
    if (!tool?.implementationVersion) throw new Error("tool_revision_missing");
    return { id, version: tool.implementationVersion, kind: tool.kind, description: tool.description,
      input: tool.inputSchema.toJSONSchema(), output: tool.outputSchema?.toJSONSchema() ?? null,
      scoped: !!tool.domainScoped, automatic: !!tool.automaticWrites, exempt: !!tool.approvalExempt,
      external: !!tool.external,
      retired: !!tool.retired, unavailable: tool.unavailable?.() ?? null };
  });
  const resolved = cases.map(test => ({ test, fixtures: EvaluationFixturesSchema.parse({ knowledge, ...test.fixtures }) }));
  const payload: EvaluationManifest = {
    version: 1, agentId: config.id, ownerId: config.ownerId, agentVersion: config.version,
    draftHash: artifactHash(config), testsFingerprint: testFingerprint(cases), providerHash: artifactHash(providerSettings), knowledgeHash: artifactHash(knowledge),
    policyHash: artifactHash({ revision: EVALUATION_POLICY_REVISION, workspacePolicy: options.workspacePolicy ?? null, requireWriteApproval: config.requireWriteApproval,
      enabledTools: config.enabledTools, limits: config.limits, suiteBudgetUsd: 0.1, caseBudgetUsd: 0.02, suiteMs: 90_000, caseMs: 30_000, grader: "gemini-policy-v1" }),
    toolsHash: artifactHash(tools), cases: resolved.map(({ test, fixtures }) => ({ id: test.id, fixturesHash: artifactHash(fixtures), assertionsHash: artifactHash(effectiveAssertions(test, fixtureSnapshot(fixtures, config.ownerId))) })),
  };
  return { payload, hash: artifactHash(payload), resolved };
}
