import type { RunStep } from "@/lib/agents/contracts";
import { buildScenario, pickScenario, type ScenarioKey } from "@/lib/fixtures/scenarios";
import { outcomeOf, RunClientError, type RunClient, type RunHistory } from "./client";
import { readRunStream } from "./ndjson";
import { deriveTrace } from "./reduce-events";

export type MockRunClientOptions = {
  /** Delay before each event; 0 in tests. */
  delayMs?: number;
  /** Force one scenario instead of routing by message text. */
  scenario?: ScenarioKey;
  now?: () => number;
};

/** Encodes events as NDJSON and deliberately splits every line across two chunks to exercise the parser. */
export function fixtureStream(events: RunStep[], delayMs: number, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.flatMap(e => {
    const line = JSON.stringify(e) + "\n";
    const cut = Math.floor(line.length / 2);
    return [line.slice(0, cut), line.slice(cut)];
  });
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal?.aborted || i >= chunks.length) return controller.close();
      if (delayMs && i % 2 === 0) await new Promise(r => setTimeout(r, delayMs));
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

export function createMockRunClient(options: MockRunClientOptions = {}): RunClient {
  const { delayMs = 350, now = Date.now } = options;
  const runs = new Map<string, { agentId: string; events: RunStep[] }>();
  const pending = new Map<string, { runId: string; approve: RunStep[]; reject: RunStep[]; expiresAt: number }>();
  let counter = 0;

  async function play(runId: string, events: RunStep[], onEvent: (e: RunStep) => void, signal?: AbortSignal) {
    const log = runs.get(runId)!.events;
    await readRunStream(fixtureStream(events, delayMs, signal), e => { log.push(e); onEvent(e); }, { signal });
    return outcomeOf(log);
  }

  return {
    async startRun({ agentId, message }, onEvent, signal) {
      const runId = `fx-run-${Date.now().toString(36)}-${++counter}`;
      const scenario = buildScenario(options.scenario ?? pickScenario(message), runId, now());
      runs.set(runId, { agentId, events: [] });
      if (scenario.continuation) {
        const required = scenario.events.find(e => e.type === "approval_required");
        const expiresAt = required?.type === "approval_required" ? Date.parse(required.payload.expiresAt) : now();
        pending.set(scenario.continuation.approvalId, { runId, expiresAt, ...scenario.continuation });
      }
      return play(runId, scenario.events, onEvent, signal);
    },

    async respondToApproval(approvalId, approved, onEvent, signal) {
      const entry = pending.get(approvalId);
      // Mirrors the runtime: one claim per approval; expired or reused approvals are a 409 before streaming.
      if (!entry || entry.expiresAt <= now()) throw new RunClientError("approval_unavailable", 409);
      pending.delete(approvalId);
      return play(entry.runId, approved ? entry.approve : entry.reject, onEvent, signal);
    },

    async loadRun(runId, afterSequence = 0): Promise<RunHistory> {
      const run = runs.get(runId);
      if (!run) throw new RunClientError("not_found", 404);
      const trace = deriveTrace(run.events);
      const done = run.events.findLast(e => e.type === "run_completed");
      return {
        runId, agentId: run.agentId,
        status: trace.status === "rejected" ? "completed" : trace.status === "interrupted" || !trace.status ? "running" : trace.status,
        response: trace.response, stopReason: trace.stopReason,
        usage: done?.type === "run_completed" ? done.payload.usage : { inputTokens: null, outputTokens: null, estimatedCostUsd: trace.totals.costUsd },
        events: run.events.filter(e => e.sequence > afterSequence),
      };
    },
  };
}
