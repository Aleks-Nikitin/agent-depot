import type { RunStep } from "@/lib/agents/contracts";
import { outcomeOf, RunClientError, RunHistorySchema, type RunClient } from "./client";
import { readRunStream } from "./ndjson";

// PLACEHOLDER(P3): the runtime routes need a server-only bearer token, so the browser cannot call them
// directly. These same-origin proxy routes do not exist yet; agree the paths with Dev 2, then build them.
export const playgroundEndpoints = {
  run: (agentId: string) => `/api/playground/agents/${encodeURIComponent(agentId)}/run`,
  approval: (approvalId: string) => `/api/playground/approvals/${encodeURIComponent(approvalId)}`,
  history: (runId: string, afterSequence = 0) => `/api/runs/${encodeURIComponent(runId)}?after=${afterSequence}`,
};

async function failure(res: Response): Promise<RunClientError> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  return new RunClientError(typeof body?.error === "string" ? body.error : `http_${res.status}`, res.status);
}

async function stream(url: string, body: unknown, onEvent: (e: RunStep) => void, signal?: AbortSignal) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
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

export function createHttpRunClient(): RunClient {
  return {
    startRun: ({ agentId, message }, onEvent, signal) => stream(playgroundEndpoints.run(agentId), { message }, onEvent, signal),
    respondToApproval: (approvalId, approved, onEvent, signal) =>
      stream(playgroundEndpoints.approval(approvalId), { approved }, onEvent, signal),
    async loadRun(runId, afterSequence = 0) {
      const res = await fetch(playgroundEndpoints.history(runId, afterSequence), { cache: "no-store" });
      if (!res.ok) throw await failure(res);
      return RunHistorySchema.parse(await res.json());
    },
  };
}
