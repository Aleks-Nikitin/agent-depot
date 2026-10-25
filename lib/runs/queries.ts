import { io } from "next/cache";
import { RunStepSchema, type RunStep, type Usage } from "@/lib/agents/contracts";
import { currentOwner } from "@/lib/agents/library/http";
import { getDb } from "@/lib/db/prisma";
import { FIXTURE_NOW, fixtureRuns } from "@/lib/fixtures/runs";
import { deriveTrace } from "@/lib/playground/reduce-events";
import { computeMetrics, type RunMetrics } from "./metrics";
import type { RunStatus } from "./format";

// Server-only run history reads (AgentRun + RunEvent + Approval). Do not import from client components.
// "fixtures" keeps the original fake data available for UI work without a database.
export const RUNS_SOURCE = "db" as "db" | "fixtures";

/** One row of run history. Numbers that were not reported are null (shown as "unknown"). */
export type RunSummary = {
  id: string;
  /** Display number, e.g. 129 for "#129". PLACEHOLDER(P12): only fixture runs have one; real runs show a short id. */
  number: number | null;
  agentId: string;
  agentName: string;
  /** Agent version the run used; null shows as "—". */
  version: number | null;
  model: string;
  input: string;
  status: RunStatus;
  /** Active time: excludes time spent waiting for a human approval. */
  durationMs: number | null;
  costUsd: number | null;
  tokens: number | null;
  startedAt: string;
};

export type RunApproval = {
  id: string; toolCallId: string; toolId: string; status: "pending" | "approved" | "rejected"; expiresAt: string; decidedAt: string | null;
};

export type RunDetail = RunSummary & {
  response: string | null;
  stopReason: string | null;
  usage: Usage | null;
  maxModelCalls: number;
  events: RunStep[];
  approvals: RunApproval[];
};

export type RunList = { runs: RunSummary[]; now: number; nextCursor: string | null };
export type ListRunsOptions = { agentId?: string; status?: RunStatus; source?: "playground" | "test"; limit?: number; cursor?: string };

type DbStatus = "running" | "waiting_approval" | "completed" | "blocked" | "failed";
type EventRow = { eventId: string; runId: string; sequence: number; type: string; payload: unknown; timestamp: Date };
export type RunRow = {
  id: string; agentId: string; agentVersion: number | null; status: DbStatus; configSnapshot: unknown; checkpoint: unknown;
  response: string | null; stopReason: string | null; createdAt: Date; finishedAt: Date | null;
};

// ---- Pure mapping (exported for tests) ----

/** RunEvent rows only lack schemaVersion and store timestamp as a Date; same normalization as PrismaRunStore.history(). */
export function toRunStep(row: EventRow): RunStep | null {
  const parsed = RunStepSchema.safeParse({ ...row, schemaVersion: 1, timestamp: row.timestamp.toISOString() });
  return parsed.success ? parsed.data : null;
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? v as Record<string, unknown> : {});

/** The runtime stores the user's message as the first checkpoint message: { role: "user", content }. */
export function runInput(checkpoint: unknown): string {
  const messages = record(checkpoint).messages;
  const first = Array.isArray(messages) ? messages.map(record).find(m => m.role === "user") : undefined;
  if (typeof first?.content === "string") return first.content;
  if (Array.isArray(first?.content)) {
    return first.content.map(record).filter(p => p.type === "text" && typeof p.text === "string").map(p => p.text).join(" ");
  }
  return "";
}

/** configSnapshot.model is always "gemini"; the real model id is the first part of checkpoint.driverKey. */
export function runModel(checkpoint: unknown, configSnapshot: unknown): string {
  const driverKey = record(checkpoint).driverKey;
  if (typeof driverKey === "string" && driverKey.startsWith("gemini-")) return driverKey.split(":")[0];
  const model = record(configSnapshot).model;
  return typeof model === "string" ? model : "unknown";
}

/** DB status, except a completed run whose write was rejected by a human shows as "rejected". */
export function displayStatus(dbStatus: DbStatus, traceStatus: RunStatus | null): RunStatus {
  return dbStatus === "completed" && traceStatus === "rejected" ? "rejected" : dbStatus;
}

export function toRunDetail(row: RunRow, eventRows: EventRow[], agentName: string | null,
  approvals: Array<Omit<RunApproval, "expiresAt" | "decidedAt"> & { expiresAt: Date; decidedAt: Date | null }> = []): RunDetail {
  const events = eventRows.map(toRunStep).filter((e): e is RunStep => e !== null);
  const trace = deriveTrace(events);
  const config = record(row.configSnapshot);
  const limits = record(config.limits);
  const done = events.findLast(e => e.type === "run_completed");
  const finished = row.finishedAt != null;
  const wallClock = finished ? row.finishedAt!.getTime() - row.createdAt.getTime() : null;
  return {
    id: row.id, number: null, agentId: row.agentId,
    agentName: agentName ?? (typeof config.name === "string" ? config.name : row.agentId),
    version: row.agentVersion ?? (typeof config.version === "number" ? config.version : null),
    model: runModel(row.checkpoint, row.configSnapshot),
    input: runInput(row.checkpoint),
    status: displayStatus(row.status, trace.status),
    durationMs: finished ? trace.totals.durationMs ?? wallClock : null,
    costUsd: trace.totals.costUsd, tokens: trace.totals.tokens,
    startedAt: row.createdAt.toISOString(),
    response: row.response, stopReason: row.stopReason,
    usage: done?.type === "run_completed" ? done.payload.usage : null,
    maxModelCalls: typeof limits.maxModelCalls === "number" ? limits.maxModelCalls : 5,
    events,
    approvals: approvals.map(a => ({ ...a, expiresAt: a.expiresAt.toISOString(), decidedAt: a.decidedAt?.toISOString() ?? null })),
  };
}

export function toSummary(r: RunDetail): RunSummary {
  return { id: r.id, number: r.number, agentId: r.agentId, agentName: r.agentName, version: r.version, model: r.model,
    input: r.input, status: r.status, durationMs: r.durationMs, costUsd: r.costUsd, tokens: r.tokens, startedAt: r.startedAt };
}

// ---- Reads ----

const runSelect = { id: true, agentId: true, agentVersion: true, status: true, configSnapshot: true, checkpoint: true,
  response: true, stopReason: true, createdAt: true, finishedAt: true } as const;

/** UI statuses that are not stored as-is: "rejected" is a completed run, "interrupted" never comes from the database. */
function dbStatusFor(status: RunStatus): DbStatus | null {
  if (status === "rejected") return "completed";
  if (status === "interrupted") return null;
  return status;
}

async function agentNames(ids: string[]): Promise<Map<string, string>> {
  const agents = await getDb().agent.findMany({ where: { id: { in: ids }, ownerId: currentOwner() }, select: { id: true, name: true } });
  return new Map(agents.map(a => [a.id, a.name]));
}

export async function listRuns({ agentId, status, source = "playground", limit = 50, cursor }: ListRunsOptions = {}): Promise<RunList> {
  if (RUNS_SOURCE === "fixtures") {
    const runs = fixtureRuns.map(toSummary).filter(r => (!agentId || r.agentId === agentId) && (!status || r.status === status));
    return { runs: runs.slice(0, limit), now: FIXTURE_NOW, nextCursor: null };
  }
  // Database reads must run per request, not during prerendering (Cache Components cannot detect Prisma IO).
  await io();
  if (status === "interrupted") return { runs: [], now: Date.now(), nextCursor: null };
  const db = getDb();
  const dbStatus = status ? dbStatusFor(status) : null;
  const rows = await db.agentRun.findMany({
    where: { ownerId: currentOwner(), source, ...(agentId ? { agentId } : {}), ...(dbStatus ? { status: dbStatus } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: runSelect,
  });
  const page = rows.slice(0, limit);
  const ids = page.map(r => r.id);
  const [events, names] = await Promise.all([
    db.runEvent.findMany({ where: { runId: { in: ids } }, orderBy: [{ runId: "asc" }, { sequence: "asc" }] }),
    agentNames([...new Set(page.map(r => r.agentId))]),
  ]);
  const byRun = Map.groupBy(events, e => e.runId);
  const runs = page.map(r => toSummary(toRunDetail(r, byRun.get(r.id) ?? [], names.get(r.agentId) ?? null)))
    // completed vs rejected share a DB status; the trace decides which one this run is.
    .filter(r => !status || r.status === status);
  return { runs, now: Date.now(), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

export async function getRun(id: string): Promise<{ run: RunDetail; now: number } | null> {
  if (RUNS_SOURCE === "fixtures") {
    const run = fixtureRuns.find(r => r.id === id || String(r.number) === id);
    return run ? { run, now: FIXTURE_NOW } : null;
  }
  await io();
  const row = await getDb().agentRun.findFirst({
    where: { id, ownerId: currentOwner() },
    select: { ...runSelect, events: { orderBy: { sequence: "asc" } },
      approvals: { select: { id: true, toolCallId: true, toolId: true, status: true, expiresAt: true, decidedAt: true } } },
  });
  if (!row) return null;
  const names = await agentNames([row.agentId]);
  return { run: toRunDetail(row, row.events, names.get(row.agentId) ?? null, row.approvals), now: Date.now() };
}

export async function getRunMetrics({ agentId }: { agentId?: string } = {}): Promise<RunMetrics> {
  const { runs } = await listRuns({ agentId, limit: 100 });
  return computeMetrics(runs);
}
