import type { RunStep, Usage } from "@/lib/agents/contracts";
import { FIXTURE_NOW, fixtureRuns } from "@/lib/fixtures/runs";
import type { RunStatus } from "./format";

// PLACEHOLDER(P7): fixture-backed for the UI phase. Replace with owner-scoped reads of AgentRun + RunEvent
// (agent version comes from configSnapshot.version, not AgentRun.version).

/** One row of run history. Numbers that were not reported are null (shown as "unknown"). */
export type RunSummary = {
  id: string;
  /** Display number, e.g. 129 for "#129". PLACEHOLDER(P12): no sequential number exists in the database yet. */
  number: number;
  agentId: string;
  agentName: string;
  version: number;
  model: string;
  input: string;
  status: RunStatus;
  durationMs: number | null;
  costUsd: number | null;
  tokens: number | null;
  startedAt: string;
};

export type RunDetail = RunSummary & {
  response: string | null;
  stopReason: string | null;
  usage: Usage | null;
  maxModelCalls: number;
  events: RunStep[];
};

export type RunList = { runs: RunSummary[]; now: number };

function toSummary(r: RunDetail): RunSummary {
  return { id: r.id, number: r.number, agentId: r.agentId, agentName: r.agentName, version: r.version, model: r.model,
    input: r.input, status: r.status, durationMs: r.durationMs, costUsd: r.costUsd, tokens: r.tokens, startedAt: r.startedAt };
}

export async function listRuns(): Promise<RunList> {
  return { runs: fixtureRuns.map(toSummary), now: FIXTURE_NOW };
}

export async function getRun(id: string): Promise<{ run: RunDetail; now: number } | null> {
  const run = fixtureRuns.find(r => r.id === id || String(r.number) === id);
  return run ? { run, now: FIXTURE_NOW } : null;
}
