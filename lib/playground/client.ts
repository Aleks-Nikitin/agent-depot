import { z } from "zod";
import { RunStatusSchema, RunStepSchema, UsageSchema, type RunStep } from "@/lib/agents/contracts";
import type { RunStatus } from "@/lib/runs/format";
import { deriveTrace } from "./reduce-events";

// The replaceable browser boundary. The mock and the real HTTP client both implement this,
// and every playground component talks only to it. Never import server-only runAgent() here.

export type StartRunRequest = { agentId: string; message: string };

export type RunOutcome = {
  runId: string | null;
  status: RunStatus;
  response: string | null;
  stopReason: string | null;
  /** Set when the run paused for a human decision. */
  approvalId: string | null;
};

/** Same shape as PrismaRunStore.history(). */
export const RunHistorySchema = z.object({
  runId: z.string(), agentId: z.string(), status: RunStatusSchema,
  response: z.string().nullable(), stopReason: z.string().nullable(),
  usage: UsageSchema, events: z.array(RunStepSchema),
});
export type RunHistory = z.infer<typeof RunHistorySchema>;

export type OnEvent = (event: RunStep) => void;

export interface RunClient {
  startRun(request: StartRunRequest, onEvent: OnEvent, signal?: AbortSignal): Promise<RunOutcome>;
  respondToApproval(approvalId: string, approved: boolean, onEvent: OnEvent, signal?: AbortSignal): Promise<RunOutcome>;
  /** Replays a stored run; pass afterSequence to fetch only what is missing. */
  loadRun(runId: string, afterSequence?: number): Promise<RunHistory>;
}

/** Errors before streaming starts (bad request, 404, 409 approval already used or expired...). */
export class RunClientError extends Error {
  constructor(readonly code: string, readonly status?: number) { super(code); }
}

/** A stream that ends without a terminal or pause event is "interrupted", never success. */
export function outcomeOf(events: RunStep[]): RunOutcome {
  const trace = deriveTrace(events);
  const status: RunStatus = !trace.status || trace.status === "running" ? "interrupted" : trace.status;
  return {
    runId: trace.runId, status, response: trace.response,
    stopReason: status === "interrupted" ? "stream_ended" : trace.stopReason,
    approvalId: trace.pendingApproval?.id ?? null,
  };
}
