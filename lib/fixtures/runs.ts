import { deriveTrace } from "@/lib/playground/reduce-events";
import type { RunDetail } from "@/lib/runs/queries";
import { buildScenario, FIXTURE_EPOCH, type ScenarioKey } from "./scenarios";

// FIXTURE DATA: the agents and run history #123–#129 from the design. Every run number is derived from
// the scenario events, so the table, metrics and run detail always agree with the trace.

export type AgentHeaderData = {
  toolWarnings?: string[];
  id: string;
  name: string;
  version: number;
  status: "published" | "draft";
  publishedVersion: number | null;
  model: string;
  toolCount: number;
  costCapUsd: number;
  maxModelCalls: number;
};

/** Agent the nav's Playground / Tests links open: the seeded demo agent that exists in the database. */
export const DEFAULT_AGENT_ID = "support-demo";

// PLACEHOLDER(P6): read from Dev 1's agent store (Agent.published / publishedVersion, config.limits).
const agents: Record<string, AgentHeaderData> = {
  "acmestore-support": { id: "acmestore-support", name: "acmestore-support", version: 3, status: "draft", publishedVersion: 2,
    model: "gemini-flash", toolCount: 2, costCapUsd: 0.25, maxModelCalls: 8 },
  "competitor-pricing": { id: "competitor-pricing", name: "competitor-pricing", version: 1, status: "published", publishedVersion: 1,
    model: "gemini-flash", toolCount: 2, costCapUsd: 0.25, maxModelCalls: 8 },
};

export function getFixtureAgent(id: string): AgentHeaderData {
  return agents[id] ?? { id, name: id, version: 1, status: "draft", publishedVersion: null,
    model: "gemini", toolCount: 0, costCapUsd: 0.05, maxModelCalls: 5 };
}

export const WRITE_TOOLS = new Set(["send_email", "create_ticket"]);

/** "Now" for fixture timestamps, so relative times ("4 min ago") are deterministic. */
export const FIXTURE_NOW = FIXTURE_EPOCH + 60 * 60_000;

type Def = { number: number; agentId: string; version: number; scenario: ScenarioKey; minutesAgo: number; input?: string; decision?: "approve" | "reject" };

const defs: Def[] = [
  { number: 129, agentId: "acmestore-support", version: 2, scenario: "refundApproval", minutesAgo: 0.2 },
  { number: 128, agentId: "acmestore-support", version: 2, scenario: "returnPolicy", minutesAgo: 1 },
  { number: 127, agentId: "competitor-pricing", version: 1, scenario: "competitorPricing", minutesAgo: 4 },
  { number: 126, agentId: "acmestore-support", version: 3, scenario: "providerFailure", minutesAgo: 6, input: "Do you price match other stores?" },
  { number: 125, agentId: "acmestore-support", version: 2, scenario: "refundApproval", minutesAgo: 12, input: "Refund order 0981", decision: "reject" },
  { number: 124, agentId: "competitor-pricing", version: 1, scenario: "budgetLimit", minutesAgo: 15 },
  { number: 123, agentId: "acmestore-support", version: 2, scenario: "shippingTime", minutesAgo: 18 },
];

function build(d: Def): RunDetail {
  const id = `run-${d.number}`;
  const s = buildScenario(d.scenario, id, FIXTURE_NOW - d.minutesAgo * 60_000);
  const events = d.decision && s.continuation ? [...s.events, ...s.continuation[d.decision]] : s.events;
  const trace = deriveTrace(events);
  const done = events.findLast(e => e.type === "run_completed");
  const agent = getFixtureAgent(d.agentId);
  return {
    id, number: d.number, agentId: d.agentId, agentName: agent.name, version: d.version, model: agent.model,
    input: d.input ?? s.message, status: trace.status ?? "running",
    durationMs: trace.totals.durationMs, costUsd: trace.totals.costUsd, tokens: trace.totals.tokens,
    startedAt: events[0].timestamp, response: trace.response, stopReason: trace.stopReason,
    usage: done?.type === "run_completed" ? done.payload.usage : null,
    maxModelCalls: agent.maxModelCalls, events, approvals: [],
  };
}

export const fixtureRuns: RunDetail[] = defs.map(build);
