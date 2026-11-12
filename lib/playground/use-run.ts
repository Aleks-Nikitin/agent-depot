"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunStep } from "@/lib/agents/contracts";
import { RunClientError, type RunClient, type RunOutcome } from "./client";
import { createHttpRunClient } from "./http-client";
import { createMockRunClient } from "./mock-client";
import { addEvents, emptyTrace, type Trace } from "./reduce-events";

// Production UI always uses the authenticated runtime. Mocks are explicit test fixtures only.
export const CLIENT_MODE = "http" as "mock" | "http";

export function defaultRunClient(): RunClient {
  return CLIENT_MODE === "mock" ? createMockRunClient() : createHttpRunClient();
}

export type UseRun = {
  trace: Trace;
  busy: boolean;
  /** Set when the stream ended without a terminal event; shown instead of a success state. */
  interrupted: boolean;
  error: string | null;
  start: (agentId: string, message: string) => Promise<RunOutcome | null>;
  decide: (approvalId: string, approved: boolean) => Promise<RunOutcome | null>;
  /** Reload a run by id (refresh / history), fetching only events we are missing. */
  replay: (runId: string) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
};

export function useRun(client?: RunClient): UseRun {
  const runClient = useMemo(() => client ?? defaultRunClient(), [client]);
  const [trace, setTrace] = useState<Trace>(emptyTrace);
  const [busy, setBusy] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const traceRef = useRef(trace);

  useEffect(() => { traceRef.current = trace; }, [trace]);
  useEffect(() => () => abort.current?.abort(), []);

  const onEvent = useCallback((e: RunStep) => setTrace(t => addEvents(t, [e])), []);

  const guard = useCallback(async (task: (signal: AbortSignal) => Promise<RunOutcome>) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(null); setInterrupted(false);
    try {
      const outcome = await task(controller.signal);
      setInterrupted(outcome.status === "interrupted");
      return outcome;
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof RunClientError ? e.code : "runtime_unavailable");
      return null;
    } finally {
      if (abort.current === controller) { abort.current = null; setBusy(false); }
    }
  }, []);

  const start = useCallback((agentId: string, message: string) => {
    setTrace(emptyTrace);
    return guard(signal => runClient.startRun({ agentId, message, onAccepted: runId => setTrace(t => ({ ...t, runId, status: "running" })) }, onEvent, signal));
  }, [guard, runClient, onEvent]);

  const decide = useCallback((approvalId: string, approved: boolean) =>
    guard(signal => runClient.respondToApproval(approvalId, approved, onEvent, signal)), [guard, runClient, onEvent]);

  const replay = useCallback(async (runId: string) => {
    await guard(async signal => {
      const current = traceRef.current;
      const after = current.runId === runId && !current.missingSequences.length ? current.lastSequence : 0;
      const history = await runClient.loadRun(runId, after);
      signal.throwIfAborted();
      setTrace(t => ({ ...addEvents(t.runId === runId ? t : emptyTrace, history.events), runId, status: history.status }));
      if (history.status === "running" && runClient.followRun) {
        const cursor = history.events.at(-1)?.sequence ?? after;
        return runClient.followRun(runId, onEvent, signal, cursor);
      }
      return { runId, status: history.status, response: history.response, stopReason: history.stopReason, approvalId: null };
    });
  }, [runClient, guard, onEvent]);

  const cancel = useCallback(async () => {
    const id = traceRef.current.runId;
    if (id && runClient.cancelRun) {
      try { await runClient.cancelRun(id); } catch { setError("cancellation_unavailable"); }
    }
  }, [runClient]);

  const reset = useCallback(() => {
    abort.current?.abort();
    setTrace(emptyTrace); setError(null); setInterrupted(false); setBusy(false);
  }, []);

  return { trace, busy, interrupted, error, start, decide, replay, cancel, reset };
}
