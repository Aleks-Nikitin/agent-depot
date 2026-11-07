import { z } from "zod";
import type { RunStep } from "@/lib/agents/contracts";
import { outcomeOf, RunClientError, RunHistorySchema, type RunClient } from "./client";
import { readRunStream } from "./ndjson";

// Session cookies authorize these same-origin runtime routes; no browser bearer token or proxy.
// The history endpoint still belongs to the monitoring backend integration.
export const playgroundEndpoints = {
  run: (agentId: string) => `/api/agents/${encodeURIComponent(agentId)}/run`,
  approval: (approvalId: string) => `/api/approvals/${encodeURIComponent(approvalId)}`,
  history: (runId: string, afterSequence = 0) => `/api/runs/${encodeURIComponent(runId)}?after=${afterSequence}`,
};

async function failure(res: Response): Promise<RunClientError> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  return new RunClientError(typeof body?.error === "string" ? body.error : `http_${res.status}`, res.status);
}

async function stream(url: string, body: unknown, onEvent: (e: RunStep) => void, signal?: AbortSignal, requestKey?: string, onAccepted?: (runId: string) => void) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey ?? crypto.randomUUID() }, body: JSON.stringify(body), signal });
  if (res.status === 202) {
    const receipt = z.object({ runId: z.string(), jobId: z.string() }).parse(await res.json());
    onAccepted?.(receipt.runId);
    return followRun(receipt.runId, onEvent, signal);
  }
  if (!res.ok || !res.body) throw await failure(res);
  const seen: RunStep[] = [];
  try {
    await readRunStream(res.body, e => { seen.push(e); onEvent(e); }, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    // Dropped connection mid-stream: fall through and report what we saw as interrupted.
  }
  return outcomeOf(seen);
}

async function followRun(runId: string, onEvent: (e: RunStep) => void, signal?: AbortSignal, afterSequence = 0) {
  let cursor = afterSequence; let errors = 0;
  const seen: RunStep[] = [];
  const receive = (event: RunStep) => { if (event.sequence > cursor) { cursor = event.sequence; seen.push(event); onEvent(event); } };
  while (!signal?.aborted) {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events?after=${cursor}`, { cache: "no-store", signal });
      if (!response.ok || !response.body) throw await failure(response);
      await readRunStream(response.body, receive, { signal });
      const res = await fetch(playgroundEndpoints.history(runId, cursor), { cache: "no-store", signal });
      if (!res.ok) throw await failure(res);
      const history = RunHistorySchema.parse(await res.json()); history.events.forEach(receive);
      if (history.status !== "running") {
        if (history.status === "waiting_approval") {
          const full = await fetch(playgroundEndpoints.history(runId), { cache: "no-store", signal });
          if (!full.ok) throw await failure(full);
          return outcomeOf(RunHistorySchema.parse(await full.json()).events);
        }
        return { runId, status: history.status, response: history.response, stopReason: history.stopReason, approvalId: null };
      }
      errors = 0;
    } catch (error) { if (signal?.aborted || ++errors >= 6) throw error; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  signal?.throwIfAborted();
  return outcomeOf(seen);
}

export function createHttpRunClient(): RunClient {
  return {
    followRun,
    async cancelRun(runId) {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw await failure(response);
    },
    startRun: ({ agentId, message, onAccepted }, onEvent, signal) => stream(playgroundEndpoints.run(agentId), { message }, onEvent, signal, undefined, onAccepted),
    respondToApproval: (approvalId, approved, onEvent, signal) =>
      stream(playgroundEndpoints.approval(approvalId), { approved }, onEvent, signal),
    async loadRun(runId, afterSequence = 0) {
      const res = await fetch(playgroundEndpoints.history(runId, afterSequence), { cache: "no-store" });
      if (!res.ok) throw await failure(res);
      return RunHistorySchema.parse(await res.json());
    },
  };
}

export const ConversationSchema = z.object({
  id: z.string(), version: z.number().int(), target: z.enum(["draft", "release"]),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export function createConversationRunClient(options: {
  initial?: Conversation; version: number; target: "draft" | "release"; onSession: (session: Conversation | null) => void;
}) {
  let session = options.initial;
  let pending: { message: string; key: string } | undefined;
  const base = createHttpRunClient();
  return {
    ...base,
    resetSession() { session = undefined; pending = undefined; options.onSession(null); },
    async startRun({ agentId, message, onAccepted }: import("./client").StartRunRequest, onEvent: (event: RunStep) => void, signal?: AbortSignal) {
      if (!session) {
        const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/sessions`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ target: options.target, ...(options.target === "draft" ? { version: options.version } : {}) }),
        });
        if (!response.ok) throw await failure(response);
        session = ConversationSchema.parse(await response.json()); options.onSession(session);
      }
      if (!pending || pending.message !== message) pending = { message, key: crypto.randomUUID() };
      const outcome = await stream(`/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(session.id)}/messages`, { message }, onEvent, signal, pending.key, onAccepted);
      if (outcome.status !== "interrupted") pending = undefined;
      return outcome;
    },
  };
}
