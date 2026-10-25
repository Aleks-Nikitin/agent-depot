import type { z } from "zod";
import type { RunStatusSchema } from "@/lib/agents/contracts";

// Display formatting. Unknown (null) values render as "unknown", never as zero.

export type ContractRunStatus = z.infer<typeof RunStatusSchema>;

/**
 * What the UI shows. Extends the runtime's statuses with two display-only states:
 * - rejected: the run ended after a human rejected a write (runtime records it as completed).
 * - interrupted: the stream ended with no terminal event; never treat that as success.
 */
export type RunStatus = ContractRunStatus | "rejected" | "interrupted";

export const finishedStatuses: readonly RunStatus[] = ["completed", "rejected", "blocked", "failed", "interrupted"];
export const isFinished = (s: RunStatus) => finishedStatuses.includes(s);

export const UNKNOWN = "unknown";

/** "#127" for fixture/numbered runs, otherwise a short id. PLACEHOLDER(P12). */
export function runLabel(runId: string | null, number?: number | null): string {
  if (number != null) return `#${number}`;
  if (!runId) return "—";
  const n = runId.match(/^run-(\d+)$/)?.[1];
  return n ? `#${n}` : `#${runId.slice(-6)}`;
}

/** "v2", or "—" when the version is unknown. */
export const formatVersion = (version: number | null | undefined) => (version == null ? "—" : `v${version}`);

export function formatClock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

export function formatTokens(tokens: number | null | undefined): string {
  return tokens == null ? UNKNOWN : `${Math.round(tokens).toLocaleString("en-US")} tok`;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return UNKNOWN;
  return `$${usd.toFixed(usd >= 0.1 ? 2 : 4)}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return UNKNOWN;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 30) return "just now";
  if (seconds < 90) return "1 min ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Stop reasons from the runtime, in plain words. Unknown codes fall back to the code itself. */
const reasons: Record<string, string> = {
  write_limit: "Write-action limit reached",
  ticket_not_found: "The support ticket does not exist in this workspace",
  step_limit: "Step limit reached", tool_limit: "Tool-call limit reached", budget_limit: "Cost cap reached",
  usage_unknown: "Provider did not report usage", context_limit: "Context too large", output_limit: "Output limit reached",
  model_policy_changed: "Model or pricing changed while paused", interrupted_or_timeout: "Run timed out or was interrupted",
  execution_failed: "Execution failed", provider_failure: "Model provider failed", event_delivery_failed: "Event delivery failed",
  write_denied: "Write denied by the run policy", stream_ended: "Connection ended before the run finished",
};
export const describeReason = (code: string) => reasons[code] ?? code;
