import { EvaluationFixturesSchema, EvaluationSeedSchema } from "./isolation/fixtures";
import { StateAssertionsSchema, type StateSnapshot } from "./state/schema";
import { normalizedSnapshot, checkState } from "./state/check";
import { stateEvidence } from "./state/evidence";
import { createIsolatedAttempt } from "./isolation/attempt";
import { buildEvaluationManifest, evaluationKnowledge } from "./manifest";
import { AgentConfigSchema, type RunStep } from "@/lib/agents/contracts";
import { runAgent, type RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { runtimeServices } from "@/lib/agents/runtime/services";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { checkTestCase } from "./checks";
import { gradeAnswer } from "./grader";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { ProviderSettingsSchema, captureProviderSettings } from "@/lib/agents/releases/provider-settings";
import { testFingerprint } from "./fingerprint";
import { TestSourceSchema } from "./schema";
import type { Prisma } from "@/generated/prisma/client";
import { evaluationOutcome, PROVIDER_FAILURES } from "./outcome";
import type { TestCase, TestResult, TestRunReport } from "./types";
import { lockedPolicy, assertNarrowed } from "@/lib/workspaces/policy";
import { workspaceCall } from "@/lib/workspaces/budget";

export async function prepareEvaluation(ownerId: string, agentId: string, deps: RuntimeDependencies, transaction?: Prisma.TransactionClient, benchmark?: { config: import("@/lib/agents/contracts").AgentConfig; baseManifestHash: string }) {
  const db = getDb();
  const capture = async (tx: Prisma.TransactionClient) => {
    const locked = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 0 } } });
    if (locked.count !== 1) throw new Error("agent_not_found");
    const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
    const config = AgentConfigSchema.parse(benchmark?.config ?? agent.config);
    const workspacePolicy = await lockedPolicy(tx, ownerId, true); assertNarrowed(config, workspacePolicy);
    if (config.id !== agentId || config.ownerId !== ownerId || config.version !== agent.version) throw new Error("invalid_agent_config");
    const rows = await tx.testCase.findMany({ where: { agentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!rows.length || rows.length > 5) throw new HttpError(409, "suite_requires_one_to_five_tests");
    const cutoff = new Date(Date.now() - 180_000);
    if (await tx.testRun.findFirst({ where: { agentId, status: "running", OR: [{ jobId: { not: null } }, { createdAt: { gt: cutoff } }] } })) throw new HttpError(409, "evaluation_running");
    await tx.testRun.updateMany({ where: { agentId, status: "running", jobId: null }, data: { status: "failed", passed: false } });
    const cases: TestCase[] = rows.map(row => ({ ...row, fixtures: EvaluationSeedSchema.parse(row.fixtures), stateAssertions: StateAssertionsSchema.parse(row.stateAssertions), source: TestSourceSchema.parse(row.source), expectedBehavior: row.expectedBehavior ?? undefined }));
    const knowledge = await evaluationKnowledge(tx, ownerId, agentId);
    if (benchmark) {
      const base = buildEvaluationManifest({ config: AgentConfigSchema.parse(agent.config), cases, knowledge, providerSettings: captureProviderSettings(AgentConfigSchema.parse(agent.config)), workspacePolicy, registry: deps.registry });
      if (base.hash !== benchmark.baseManifestHash) throw new HttpError(409, "benchmark_dependencies_changed");
      const stripRoute = (c: typeof config) => { const { routing, ...rest } = c; void routing; return rest; };
      if (artifactHash(stripRoute(config)) !== artifactHash(stripRoute(AgentConfigSchema.parse(agent.config)))) throw new HttpError(409, "benchmark_config_mismatch");
    }
    const record = await tx.testRun.create({ data: { purpose: benchmark ? "benchmark" : "certification", agentId, agentVersion: config.version, results: [], passed: false,
      passedCount: 0, totalCount: cases.length, testsFingerprint: testFingerprint(cases), configHash: artifactHash(config), providerSettings: captureProviderSettings(config), status: "running" } });
    const manifest = buildEvaluationManifest({ config, cases, knowledge, workspacePolicy, providerSettings: ProviderSettingsSchema.parse(record.providerSettings), registry: deps.registry });
    await tx.evaluationManifest.create({ data: { testRunId: record.id, hash: manifest.hash, payload: manifest.payload } });
    return { config, cases, record, knowledge, manifest, workspacePolicy };
  };
  return transaction ? capture(transaction) : db.$transaction(capture);
}

export type PreparedEvaluation = Awaited<ReturnType<typeof prepareEvaluation>>;

/** Same runtime, domain effects isolated per case. Browser lifetime does not own queued execution. */
export async function runEvaluation(ownerId: string, agentId: string, signal?: AbortSignal,
  dependencies?: RuntimeDependencies, grader = gradeAnswer, prepared?: PreparedEvaluation): Promise<TestRunReport> {
  const db = getDb();
  const deps = dependencies ?? runtimeServices();
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90_000)]);
  const { config, cases, record, knowledge, manifest } = prepared ?? await prepareEvaluation(ownerId, agentId, deps);
  if (config.ownerId !== ownerId || config.id !== agentId) throw new Error("evaluation_snapshot_mismatch");
  const results: TestResult[] = [];
  const started = Date.now();
  let reservedOrSpent = 0;
  try {
    for (const testCase of cases) {
      const graderReservation = testCase.useGrader ? 0.01 : 0;
      const budget = Math.min(config.limits.maxEstimatedCostUsd, 0.02, 0.1 - reservedOrSpent - graderReservation);
      if (deadline.aborted || budget <= 0.00001) {
        results.push({ testCaseId: testCase.id, status: "error", outcome: "evaluation_unavailable", failures: [deadline.aborted ? "suite interrupted or timed out" : "suite budget reached"], response: null, runId: null, durationMs: null, costUsd: null });
        continue;
      }
      const steps: RunStep[] = [];
      let attempt: Awaited<ReturnType<typeof createIsolatedAttempt>> | undefined;
      let checked: TestResult;
      let before: StateSnapshot | undefined; let after: StateSnapshot | undefined;
      let sourceCompleted = false;
      try {
        attempt = await createIsolatedAttempt({ ownerId, suiteId: record.id, caseId: testCase.id, fixtures: EvaluationFixturesSchema.parse({ knowledge, ...testCase.fixtures }) });
        before = normalizedSnapshot(await attempt.snapshot());
        // Only tools backed by the scoped repository can access fixture state.
        // External retrieval cannot consult live services during an isolated case.
        const registry = new Map([...deps.registry].map(([id, tool]) => [id, tool.domainScoped || tool.retired ? tool
          : { ...tool, unavailable: () => "evaluation_external_tool_disabled" }]));
        const result = await runAgent({ config: { ...config, limits: { ...config.limits, maxEstimatedCostUsd: budget,
          timeoutMs: Math.min(config.limits.timeoutMs, 30_000) } }, ownerId, providerSettings: ProviderSettingsSchema.parse(record.providerSettings), message: testCase.input, approvalMode: "human",
          binding: { executionKey: artifactHash({ suiteId: record.id, caseId: testCase.id }), input: testCase.input } },
        { ...deps, domain: attempt.repository, registry, signal: deadline, onEvent: event => { steps.push(event); } });
        sourceCompleted = result.status === "completed";
        after = normalizedSnapshot(await attempt.snapshot());
        checked = checkTestCase(testCase, { steps, response: result.response });
        if (result.status !== "completed") {
          checked.status = "error";
          checked.failures.push("evaluation run did not complete");
          if (PROVIDER_FAILURES.has(result.stopReason ?? "")) checked.outcome = "provider_unavailable";
          // A forbidden attempt is an observed behavior failure even when execution stops safely.
          else if (testCase.mustNotCall.some(id => steps.some(step => step.type === "tool_requested" && step.payload.toolId === id))) {
            checked.status = "failed";
          }
        }
        const outcome = checkState(testCase, before, after, ownerId);
        if (!outcome.passed) { if (checked.status !== "error") checked.status = "failed"; checked.failures.push(...outcome.assertions.flatMap(a => a.reason ? [a.reason] : []), ...(!outcome.ownershipValid ? ["State contains records outside this owner"] : [])); }
        reservedOrSpent += result.usage.estimatedCostUsd ?? budget;
        if (testCase.useGrader && result.status === "completed" && checked.status === "passed") {
          const gradingInput = { instructions: config.instructions, question: testCase.input, answer: result.response ?? "",
            toolOutputs: steps.filter(event => event.type === "tool_finished").map(event => event.payload.output), expectedBehavior: testCase.expectedBehavior };
          const reservation = deps.driver.estimate(Buffer.byteLength(JSON.stringify(gradingInput), "utf8") * 2 + 2048, 256);
          if (reservedOrSpent + reservation > 0.1) { checked.status = "error"; checked.failures.push("suite grader budget reached"); }
          else {
            const grade = await workspaceCall(ownerId, `grader:${record.id}:${testCase.id}`, "grader", Math.max(reservation, graderReservation),
              () => grader(gradingInput, { signal: deadline, trackUsage: true }), result => result.estimatedCostUsd ?? null);
            reservedOrSpent += grade.estimatedCostUsd ?? reservation;
            if (grade.estimatedCostUsd == null) reservedOrSpent = 0.1;
            if (grade.unavailable) { checked.status = "error"; checked.outcome = "grader_unavailable"; checked.failures.push("grader unavailable"); }
            else if (!grade.followsPolicy) { checked.status = "failed"; checked.failures.push(grade.reason); }
            checked.costUsd = checked.costUsd !== null && grade.estimatedCostUsd != null ? checked.costUsd + grade.estimatedCostUsd : null;
          }
        }
      } catch (error) {
        reservedOrSpent += budget + graderReservation;
        checked = { testCaseId: testCase.id, status: "error", outcome: error instanceof Error && PROVIDER_FAILURES.has(error.message) ? "provider_unavailable" : "evaluation_unavailable", failures: ["evaluation execution unavailable"], response: null,
          runId: steps[0]?.runId ?? null, durationMs: null, costUsd: null };
      } finally {
        if (attempt && before && !after) {
          try { after = normalizedSnapshot(await attempt.snapshot()); } catch { /* Unavailable state cannot pass. */ }
        }
        try { await attempt?.dispose(); }
        catch {
          checked = { testCaseId: testCase.id, status: "error", failures: ["evaluation fixture cleanup unavailable"], response: null,
            runId: steps[0]?.runId ?? null, durationMs: null, costUsd: null };
        }
      }
      if (before && after) {
        checked!.stateEvidence = stateEvidence({ ownerId, manifestHash: manifest.hash, test: testCase, runId: checked!.runId, sourceCompleted, before, after });
        if (!checked!.stateEvidence.passed) {
          if (checked!.status === "passed") checked!.status = "failed";
          checked!.failures = [...new Set([...checked!.failures, ...checked!.stateEvidence.assertions.flatMap(a => a.reason ? [a.reason] : []), ...(!checked!.stateEvidence.ownershipValid ? ["State contains records outside this owner"] : [])])];
        }
      }
      checked!.outcome = evaluationOutcome(checked!);
      results.push(checked!);
    }
    const passedCount = results.filter(result => result.status === "passed").length;
    const saved = await db.testRun.updateMany({ where: { id: record.id, status: "running" }, data: { results: JSON.parse(JSON.stringify(results)),
      passed: passedCount === cases.length, passedCount, status: "completed", finishedAt: new Date() } });
    if (saved.count !== 1) throw new Error("evaluation_superseded");
    return { version: config.version, ranAt: record.createdAt.toISOString(), durationMs: Date.now() - started,
      manifestHash: manifest.hash, costUsd: results.every(result => result.costUsd !== null) ? results.reduce((sum, result) => sum + result.costUsd!, 0) : null, results };
  } catch (error) {
    await db.testRun.updateMany({ where: { id: record.id, status: "running" }, data: { passed: false, status: "failed", finishedAt: new Date() } });
    throw error;
  }
}
