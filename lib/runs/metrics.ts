import { isFinished } from "./format";
import type { RunSummary } from "./queries";

export type RunMetrics = {
  /** completed ÷ finished runs. Running and waiting runs are excluded from the denominator. null when nothing finished. */
  successRate: number | null;
  succeeded: number;
  finished: number;
  /** Averages over runs that reported the value; unknown values are skipped, not counted as zero. */
  avgDurationMs: number | null;
  avgCostUsd: number | null;
  pendingApprovals: number;
};

const avg = (values: Array<number | null>) => {
  const known = values.filter((v): v is number => v != null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

export function computeMetrics(runs: RunSummary[]): RunMetrics {
  const finished = runs.filter(r => isFinished(r.status));
  const succeeded = finished.filter(r => r.status === "completed").length;
  return {
    successRate: finished.length ? succeeded / finished.length : null,
    succeeded, finished: finished.length,
    avgDurationMs: avg(finished.map(r => r.durationMs)),
    avgCostUsd: avg(finished.map(r => r.costUsd)),
    pendingApprovals: runs.filter(r => r.status === "waiting_approval").length,
  };
}

/** Running success rate over finished runs, oldest first, for the trend chart. */
export function successSeries(runs: RunSummary[], limit = 20): Array<{ id: string; ok: boolean; rate: number }> {
  const finished = runs.filter(r => isFinished(r.status))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).slice(-limit);
  let ok = 0;
  return finished.map((r, i) => {
    if (r.status === "completed") ok++;
    return { id: r.id, ok: r.status === "completed", rate: ok / (i + 1) };
  });
}
