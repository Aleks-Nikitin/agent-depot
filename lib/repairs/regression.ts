import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { TestCaseInputSchema } from "@/lib/evals/schema";
import { testFingerprint } from "@/lib/evals/fingerprint";
import { lockTestAgent } from "@/lib/evals/test-cases";
import { testReportFromRecord } from "@/lib/evals/publish-gate";

export const RegressionRequestSchema = z.object({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  definition: TestCaseInputSchema,
}).strict();
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

async function source(tx: Prisma.TransactionClient, ownerId: string, runId: string) {
  const run = await tx.agentRun.findFirst({ where: { id: runId, ownerId },
    select: { id: true, agentId: true, agentVersion: true, input: true, status: true, response: true,
      stopReason: true, configSnapshot: true, events: { orderBy: { sequence: "asc" }, select: { sequence: true, type: true, payload: true } } } });
  if (!run) throw new HttpError(404, "run_not_found");
  const agent = await tx.agent.findFirst({ where: { id: run.agentId, ownerId } });
  if (!agent) throw new HttpError(404, "agent_not_found");
  if (!["failed", "blocked", "completed"].includes(run.status) || !run.input) throw new HttpError(409, "regression_requires_finished_run");
  const suite = await tx.testRun.findFirst({ where: { agentId: agent.id, results: { array_contains: [{ runId }] } },
    include: { manifest: true }, orderBy: { createdAt: "desc" } });
  const result = suite ? testReportFromRecord(suite).results.find(r => r.runId === runId) : undefined;
  const cases = await tx.testCase.findMany({ where: { agentId: agent.id } });
  const original = result && suite?.testsFingerprint === testFingerprint(cases) ? cases.find(c => c.id === result.testCaseId) : undefined;
  const definition = TestCaseInputSchema.parse(original ? { input: original.input, mustCall: original.mustCall, mustNotCall: original.mustNotCall, mustContain: original.mustContain, useGrader: original.useGrader, fixtures: original.fixtures, stateAssertions: original.stateAssertions, source: original.source,
    expectedBehavior: original.expectedBehavior ?? undefined } : { input: run.input });
  const evidence = { version: 1, runId, agentId: agent.id, agentVersion: run.agentVersion,
    configHash: artifactHash(run.configSnapshot), input: run.input, status: run.status, response: run.response,
    stopReason: run.stopReason, traceHash: artifactHash(run.events), suiteId: suite?.id ?? null,
    manifestHash: suite?.manifest?.hash ?? null, result: result ?? null };
  return { agentId: agent.id, sourceHash: artifactHash(evidence), evidence, definition,
    reusedOriginal: !!original, alreadySaved: await tx.regressionOrigin.findUnique({ where: { runId } }) };
}

/** Preview only: never infer expected behavior from a failed answer or attempted write. */
export function previewRegression(ownerId: string, runId: string) {
  return getDb().$transaction(async tx => {
    const found = await source(tx, ownerId, runId);
    return { ...found, alreadySaved: found.alreadySaved?.testCaseId ?? null };
  });
}

export async function saveRegression(ownerId: string, runId: string, input: unknown) {
  const request = RegressionRequestSchema.parse(input);
  const definition = TestCaseInputSchema.parse({ ...request.definition, source: "user" });
  if (!definition.expectedBehavior || (!definition.useGrader && !definition.mustCall.length && !definition.mustNotCall.length
    && !definition.mustContain.length && !definition.stateAssertions?.length)) throw new HttpError(400, "regression_requires_reviewed_assertion");
  return getDb().$transaction(async tx => {
    const run = await tx.agentRun.findFirst({ where: { id: runId, ownerId }, select: { agentId: true } });
    if (!run) throw new HttpError(404, "run_not_found");
    await lockTestAgent(tx, ownerId, run.agentId);
    const found = await source(tx, ownerId, runId);
    if (definition.input !== found.evidence.input) throw new HttpError(409, "regression_input_mismatch");
    const definitionHash = artifactHash(definition);
    if (found.alreadySaved) {
      if (found.alreadySaved.definitionHash !== definitionHash || found.alreadySaved.sourceHash !== request.sourceHash) throw new HttpError(409, "regression_already_saved");
      return { testCaseId: found.alreadySaved.testCaseId, agentId: found.agentId };
    }
    if (request.sourceHash !== found.sourceHash) throw new HttpError(409, "regression_source_changed");
    if (await tx.testCase.count({ where: { agentId: found.agentId } }) >= 5) throw new HttpError(409, "test_case_limit");
    const test = await tx.testCase.create({ data: { ...definition, agentId: found.agentId } });
    await tx.regressionOrigin.create({ data: { ownerId, runId, testCaseId: test.id, sourceHash: found.sourceHash, definitionHash, evidence: json(found.evidence) } });
    return { testCaseId: test.id, agentId: found.agentId };
  });
}
