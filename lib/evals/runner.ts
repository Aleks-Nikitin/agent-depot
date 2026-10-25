import { AgentConfigSchema, type RunStep } from "@/lib/agents/contracts";
import { runAgent, type RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { runtimeServices } from "@/lib/agents/runtime/services";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { checkTestCase } from "./checks";
import { gradeAnswer } from "./grader";
import { testFingerprint } from "./fingerprint";
import { TestSourceSchema } from "./schema";
import type { TestCase, TestResult, TestRunReport } from "./types";

/** Same runtime, writes denied. Suite budgets are estimates, not an invoice guarantee. */
export async function runEvaluation(ownerId: string, agentId: string, signal?: AbortSignal,
  dependencies?: RuntimeDependencies, grader = gradeAnswer): Promise<TestRunReport> {
  const db = getDb();
  const deps = dependencies ?? runtimeServices();
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90_000)]);
  const { config, cases, record } = await db.$transaction(async tx => {
    const locked = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 0 } } });
    if (locked.count !== 1) throw new Error("agent_not_found");
    const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
    const config = AgentConfigSchema.parse(agent.config);
    if (config.id !== agentId || config.ownerId !== ownerId || config.version !== agent.version) throw new Error("invalid_agent_config");
    const rows = await tx.testCase.findMany({ where: { agentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!rows.length || rows.length > 5) throw new HttpError(409, "suite_requires_one_to_five_tests");
    const cutoff = new Date(Date.now() - 180_000);
    if (await tx.testRun.findFirst({ where: { agentId, status: "running", createdAt: { gt: cutoff } } })) throw new HttpError(409, "evaluation_running");
    await tx.testRun.updateMany({ where: { agentId, status: "running" }, data: { status: "failed", passed: false } });
    const cases: TestCase[] = rows.map(row => ({ ...row, source: TestSourceSchema.parse(row.source), expectedBehavior: row.expectedBehavior ?? undefined }));
    const record = await tx.testRun.create({ data: { agentId, agentVersion: config.version, results: [], passed: false,
      passedCount: 0, totalCount: cases.length, testsFingerprint: testFingerprint(cases), status: "running" } });
    return { config, cases, record };
  });
  const results: TestResult[] = [];
  const started = Date.now();
  let reservedOrSpent = 0;
  try {
    for (const testCase of cases) {
      const graderReservation = testCase.useGrader ? 0.01 : 0;
      const budget = Math.min(config.limits.maxEstimatedCostUsd, 0.02, 0.1 - reservedOrSpent - graderReservation);
      if (deadline.aborted || budget <= 0.00001) {
        results.push({ testCaseId: testCase.id, status: "error", failures: [deadline.aborted ? "suite interrupted or timed out" : "suite budget reached"], response: null, runId: null, durationMs: null, costUsd: null });
        continue;
      }
      const steps: RunStep[] = [];
      try {
        const result = await runAgent({ config: { ...config, limits: { ...config.limits, maxEstimatedCostUsd: budget,
          timeoutMs: Math.min(config.limits.timeoutMs, 30_000) } }, ownerId, message: testCase.input, approvalMode: "deny" },
        { ...deps, signal: deadline, onEvent: event => { steps.push(event); } });
        const checked = checkTestCase(testCase, { steps, response: result.response });
        reservedOrSpent += result.usage.estimatedCostUsd ?? budget;
        if (testCase.useGrader && result.status === "completed") {
          const gradingInput = { instructions: config.instructions, question: testCase.input, answer: result.response ?? "",
            toolOutputs: steps.filter(event => event.type === "tool_finished").map(event => event.payload.output), expectedBehavior: testCase.expectedBehavior };
          const reservation = deps.driver.estimate(Buffer.byteLength(JSON.stringify(gradingInput), "utf8") * 2 + 2048, 256);
          if (reservedOrSpent + reservation > 0.1) { checked.status = "error"; checked.failures.push("suite grader budget reached"); }
          else {
            const grade = await grader(gradingInput, { signal: deadline, trackUsage: true });
            reservedOrSpent += grade.estimatedCostUsd ?? reservation;
            if (grade.estimatedCostUsd == null) reservedOrSpent = 0.1;
            if (grade.unavailable) { checked.status = "error"; checked.failures.push("grader unavailable"); }
            else if (!grade.followsPolicy) { checked.status = "failed"; checked.failures.push(grade.reason); }
            checked.costUsd = checked.costUsd !== null && grade.estimatedCostUsd != null ? checked.costUsd + grade.estimatedCostUsd : null;
          }
        }
        results.push(checked);
      } catch {
        reservedOrSpent += budget + graderReservation;
        results.push({ testCaseId: testCase.id, status: "error", failures: ["evaluation execution unavailable"], response: null,
          runId: steps[0]?.runId ?? null, durationMs: null, costUsd: null });
      }
    }
    const passedCount = results.filter(result => result.status === "passed").length;
    const saved = await db.testRun.updateMany({ where: { id: record.id, status: "running" }, data: { results: JSON.parse(JSON.stringify(results)),
      passed: passedCount === cases.length, passedCount, status: "completed", finishedAt: new Date() } });
    if (saved.count !== 1) throw new Error("evaluation_superseded");
    return { version: config.version, ranAt: record.createdAt.toISOString(), durationMs: Date.now() - started,
      costUsd: results.every(result => result.costUsd !== null) ? results.reduce((sum, result) => sum + result.costUsd!, 0) : null, results };
  } catch (error) {
    await db.testRun.updateMany({ where: { id: record.id, status: "running" }, data: { passed: false, status: "failed", finishedAt: new Date() } });
    throw error;
  }
}
