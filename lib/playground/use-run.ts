"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunStep } from "@/lib/agents/contracts";
import { RunClientError, type RunClient, type RunOutcome } from "./client";
import { createHttpRunClient } from "./http-client";
import { createMockRunClient } from "./mock-client";
import { addEvents, emptyTrace, type Trace } from "./reduce-events";

// PLACEHOLDER(P5): flip to "http" once the proxy routes (P3) exist. Nothing else changes.
export const CLIENT_MODE = "mock" as "mock" | "http";

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
    return guard(signal => runClient.startRun({ agentId, message }, onEvent, signal));
  }, [guard, runClient, onEvent]);

  const decide = useCallback((approvalId: string, approved: boolean) =>
    guard(signal => runClient.respondToApproval(approvalId, approved, onEvent, signal)), [guard, runClient, onEvent]);

  const replay = useCallback(async (runId: string) => {
    const current = traceRef.current;
    const after = current.runId === runId && !current.missingSequences.length ? current.lastSequence : 0;
    try {
      const history = await runClient.loadRun(runId, after);
      setTrace(t => addEvents(t.runId === runId ? t : emptyTrace, history.events));
    } catch (e) {
      setError(e instanceof RunClientError ? e.code : "runtime_unavailable");
    }
  }, [runClient]);

  const reset = useCallback(() => {
    abort.current?.abort();
    setTrace(emptyTrace); setError(null); setInterrupted(false); setBusy(false);
  }, []);

  return { trace, busy, interrupted, error, start, decide, replay, reset };
}
