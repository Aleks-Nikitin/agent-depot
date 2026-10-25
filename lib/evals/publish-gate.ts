import { io } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/prisma";
import type { TestRunReport } from "./types";
import type { Prisma } from "../../generated/prisma/client";
import { testFingerprint } from "./fingerprint";

const StoredResultSchema = z.object({
  testCaseId: z.string(), status: z.enum(["passed", "failed", "error"]), failures: z.array(z.string()).default([]),
  response: z.string().nullable().default(null), runId: z.string().nullable().default(null),
  durationMs: z.number().nullable().default(null), costUsd: z.number().nullable().default(null),
});

// Server-only publish gate: a version can be published only if its latest TestRun passed.
// Do not import from client components.

export type PublishStatus = {
  canPublish: boolean;
  reason: string;
  agentVersion: number;
  passedCount: number;
  totalCount: number;
  /** ISO time of the latest TestRun for this version, or null if it was never tested. */
  lastRunAt: string | null;
};

/** The most recent TestRun for this exact agent version, or null. */
export async function latestTestRun(ownerId: string, agentId: string, agentVersion: number) {
  if (!await getDb().agent.findFirst({ where: { id: agentId, ownerId } })) throw new Error("agent_not_found");
  return getDb().testRun.findFirst({ where: { agentId, agentVersion }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

/** Latest TestRun for a version in the Tests page's report shape; malformed stored results are skipped. */
export async function latestTestReport(ownerId: string, agentId: string, agentVersion: number): Promise<TestRunReport | null> {
  const run = await latestTestRun(ownerId, agentId, agentVersion);
  if (!run) return null;
  const results = (Array.isArray(run.results) ? run.results : [])
    .map(r => StoredResultSchema.safeParse(r)).filter(r => r.success).map(r => r.data);
  const sum = (values: Array<number | null>) => values.length && values.every(v => v != null) ? values.reduce<number>((a, b) => a + (b ?? 0), 0) : null;
  return { version: run.agentVersion, ranAt: run.createdAt.toISOString(),
    durationMs: sum(results.map(r => r.durationMs)), costUsd: sum(results.map(r => r.costUsd)), results };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Throws "agent_not_found". Without agentVersion, checks the agent's current version (Agent.version). */
export async function getPublishStatus(ownerId: string, agentId: string, agentVersion?: number): Promise<PublishStatus> {
  await io(); // database reads run per request, not during prerendering
  return readPublishStatus(getDb(), ownerId, agentId, agentVersion);
}

export async function readPublishStatus(db: Pick<Prisma.TransactionClient, "agent" | "testCase" | "testRun">,
  ownerId: string, agentId: string, agentVersion?: number): Promise<PublishStatus> {
  const agent = await db.agent.findFirst({ where: { id: agentId, ownerId }, select: { version: true } });
  if (!agent) throw new Error("agent_not_found");
  const version = agentVersion ?? agent.version;
  const [cases, run] = await Promise.all([db.testCase.findMany({ where: { agentId } }),
    db.testRun.findFirst({ where: { agentId, agentVersion: version }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })]);
  const testCount = cases.length;
  const counts = { agentVersion: version, passedCount: run?.passedCount ?? 0, totalCount: run?.totalCount ?? 0, lastRunAt: run?.createdAt.toISOString() ?? null };

  if (testCount === 0) return { canPublish: false, reason: "Add at least one test before publishing", ...counts };
  if (!run) return { canPublish: false, reason: "No test run for this version yet", ...counts };
  if (run.status !== "completed") return { canPublish: false, reason: "Latest test run is not complete", ...counts };
  if (!run.testsFingerprint || run.testsFingerprint !== testFingerprint(cases)) return { canPublish: false, reason: "Test cases changed. Run tests again", ...counts };
  if (!run.passed) {
    const failing = run.totalCount - run.passedCount;
    return { canPublish: false, reason: failing > 0 ? `${plural(failing, "test")} failing` : "Latest test run did not pass", ...counts };
  }
  return { canPublish: true, reason: `All ${plural(run.totalCount, "test")} passed`, ...counts };
}

/** Metrics for recorded suite evidence, not inferred model quality. */
export async function getTestQuality(ownerId: string, agentId: string, version: number, report: TestRunReport | null) {
  if (!await getDb().agent.findFirst({ where: { id: agentId, ownerId } })) throw new Error("agent_not_found");
  const previous = await getDb().testRun.findFirst({ where: { agentId, agentVersion: { lt: version }, status: "completed" },
    orderBy: [{ agentVersion: "desc" }, { createdAt: "desc" }, { id: "desc" }] });
  const runIds = report?.results.flatMap(result => result.runId ? [result.runId] : []) ?? [];
  const toolErrors = await getDb().runEvent.count({ where: { runId: { in: runIds }, run: { ownerId }, type: "tool_failed" } });
  const failures = new Map<string, number>();
  for (const result of report?.results ?? []) for (const failure of result.failures) failures.set(failure, (failures.get(failure) ?? 0) + 1);
  return { previousVersion: previous?.agentVersion ?? null,
    previousPassRate: previous && previous.totalCount ? previous.passedCount / previous.totalCount : null,
    toolErrors, mostCommonFailure: [...failures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
}
