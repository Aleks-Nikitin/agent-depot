import { io } from "next/cache";
import { z } from "zod";
import { currentOwner } from "@/lib/agents/library/http";
import { getDb } from "@/lib/db/prisma";
import type { TestRunReport } from "./types";

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
export async function latestTestRun(agentId: string, agentVersion: number) {
  return getDb().testRun.findFirst({ where: { agentId, agentVersion }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

/** Latest TestRun for a version in the Tests page's report shape; malformed stored results are skipped. */
export async function latestTestReport(agentId: string, agentVersion: number): Promise<TestRunReport | null> {
  const run = await latestTestRun(agentId, agentVersion);
  if (!run) return null;
  const results = (Array.isArray(run.results) ? run.results : [])
    .map(r => StoredResultSchema.safeParse(r)).filter(r => r.success).map(r => r.data);
  const sum = (values: Array<number | null>) => values.length && values.every(v => v != null) ? values.reduce<number>((a, b) => a + (b ?? 0), 0) : null;
  return { version: run.agentVersion, ranAt: run.createdAt.toISOString(),
    durationMs: sum(results.map(r => r.durationMs)), costUsd: sum(results.map(r => r.costUsd)), results };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Throws "agent_not_found". Without agentVersion, checks the agent's current version (Agent.version). */
export async function getPublishStatus(agentId: string, agentVersion?: number): Promise<PublishStatus> {
  await io(); // database reads run per request, not during prerendering
  const db = getDb();
  const agent = await db.agent.findFirst({ where: { id: agentId, ownerId: currentOwner() }, select: { version: true } });
  if (!agent) throw new Error("agent_not_found");
  const version = agentVersion ?? agent.version;
  const [testCount, run] = await Promise.all([db.testCase.count({ where: { agentId } }), latestTestRun(agentId, version)]);
  const counts = { agentVersion: version, passedCount: run?.passedCount ?? 0, totalCount: run?.totalCount ?? 0, lastRunAt: run?.createdAt.toISOString() ?? null };

  if (testCount === 0) return { canPublish: false, reason: "Add at least one test before publishing", ...counts };
  if (!run) return { canPublish: false, reason: "No test run for this version yet", ...counts };
  if (!run.passed) {
    const failing = run.totalCount - run.passedCount;
    return { canPublish: false, reason: failing > 0 ? `${plural(failing, "test")} failing` : "Latest test run did not pass", ...counts };
  }
  return { canPublish: true, reason: `All ${plural(run.totalCount, "test")} passed`, ...counts };
}
