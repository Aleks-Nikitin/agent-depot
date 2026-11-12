import { getDb } from "@/lib/db/prisma";
import { testReportFromRecord } from "@/lib/evals/publish-gate";
import { BenchmarkPayloadSchema, ownedBenchmark } from "./service";
import type { TestResult } from "@/lib/evals/types";

export function summarize(results: TestResult[], expected: number, attempts: { estimatedCostUsd: number | null; reservedCostUsd: number }[]) {
  const passed = results.filter(r => r.status === "passed" && r.outcome === "pass").length;
  const knownCosts = results.filter(r => r.costUsd !== null).map(r => r.costUsd!);
  const costComplete = results.length === expected && knownCosts.length === expected;
  const total = knownCosts.reduce((a, b) => a + b, 0);
  const latencies = results.flatMap(r => r.durationMs === null ? [] : [r.durationMs]).sort((a, b) => a - b);
  const percentile = (p: number) => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;
  const rate = expected ? passed / expected : 0; const z = 1.96; const denominator = 1 + z * z / Math.max(1, expected);
  const center = (rate + z * z / (2 * Math.max(1, expected))) / denominator;
  const margin = z * Math.sqrt(rate * (1 - rate) / Math.max(1, expected) + z * z / (4 * Math.max(1, expected) ** 2)) / denominator;
  return { expected, observed: results.length, passed, behaviorFailures: results.filter(r => r.outcome === "behavior_failure").length,
    unavailable: expected - results.length + results.filter(r => r.status === "error").length,
    stateCorrect: results.filter(r => r.stateEvidence?.passed && r.stateEvidence.sourceCompleted && r.stateEvidence.ownershipValid).length,
    costUsd: costComplete ? total : null, knownCostLowerBoundUsd: total, costPerSuccessUsd: costComplete && passed ? total / passed : null,
    p50Ms: percentile(.5), p95Ms: percentile(.95), latencyObservations: latencies.length,
    attempts: attempts.length, unknownAttempts: attempts.filter(a => a.estimatedCostUsd === null).length,
    reservedAttemptUsd: attempts.reduce((sum, a) => sum + a.reservedCostUsd, 0),
    passRate: rate, descriptiveInterval95: [Math.max(0, center - margin), Math.min(1, center + margin)] };
}
async function benchmarkCoreView(ownerId: string, id: string) {
  const db = getDb(); const row = await ownedBenchmark(ownerId, id); const payload = BenchmarkPayloadSchema.parse(row.payload);
  const jobs = await db.executionJob.findMany({ where: { id: { in: row.childJobIds }, ownerId }, select: { id: true, status: true, testRunId: true, reason: true } });
  const children = await Promise.all(row.childJobIds.map(async (jobId, ordinal) => {
    const job = jobs.find(j => j.id === jobId)!;
    const suite = job?.testRunId ? await db.testRun.findUnique({ where: { id: job.testRunId }, include: { manifest: true } }) : null;
    const report = suite?.purpose === "benchmark" && suite.agentId === row.agentId && suite.agentVersion === payload.config.version ? testReportFromRecord(suite) : null;
    if (report) report.results = report.results.filter(r => payload.cases.some(c => c.id === r.testCaseId) && report.results.filter(other => other.testCaseId === r.testCaseId).length === 1);
    return { ordinal, arm: ordinal % 2 === 0 ? "primary" : "routed", repeat: Math.floor(ordinal / 2) + 1, job, report };
  }));
  const arms = await Promise.all((["primary", "routed"] as const).map(async arm => {
    const results = children.filter(c => c.arm === arm).flatMap(c => c.report?.results ?? []);
    const runs = results.flatMap(r => r.runId ? [r.runId] : []);
    const attempts = await db.modelAttempt.findMany({ where: { runId: { in: runs }, run: { ownerId } },
      select: { estimatedCostUsd: true, reservedCostUsd: true } });
    return { arm, ...summarize(results, payload.cases.length * row.repeats, attempts) };
  }));
  return { id: row.id, agentId: row.agentId, version: payload.config.version, status: row.status, reason: row.reason,
    workloadHash: payload.workloadHash, baseManifestHash: row.baseManifestHash, repeats: row.repeats, policy: payload.policy, cases: payload.cases, arms, children,
    notice: "Descriptive results only. Repeated tasks are correlated; the interval assumes independent trials and does not establish production quality or savings." };
}

export async function benchmarkView(ownerId: string, id: string, compareTo?: string) {
  const current = await benchmarkCoreView(ownerId, id);
  const prior = compareTo && compareTo !== id ? await benchmarkCoreView(ownerId, compareTo) : null;
  const compatible = !!prior && prior.agentId === current.agentId && prior.workloadHash === current.workloadHash;
  const previous = await getDb().routingBenchmark.findMany({ where: { ownerId, agentId: current.agentId, id: { not: id } },
    orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, createdAt: true } });
  return { ...current, previous: previous.map(p => ({ ...p, createdAt: p.createdAt.toISOString() })),
    comparison: prior ? { id: prior.id, version: prior.version, status: prior.status, compatible, arms: compatible ? prior.arms : [],
      reason: compatible ? null : "Tasks, fixtures, knowledge, tools, policy or provider declarations changed; these results are not a matched version comparison." } : null };
}
