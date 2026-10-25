"use client";

import { Button } from "@/components/ui/button";
import { downloadFile } from "@/components/ui/cn";
import type { RunDetail } from "@/lib/runs/queries";
import type { TraceTotals } from "@/lib/playground/reduce-events";
import { formatCost, formatDuration, UNKNOWN } from "@/lib/runs/format";
import { MetricCard } from "./metric-cards";

/** The five stat cards on run detail: duration, tokens, cost, steps, errors. */
export function RunStats({ run, totals, steps }: { run: RunDetail; totals: TraceTotals; steps: number }) {
  const u = run.usage;
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <MetricCard label="Duration" value={formatDuration(totals.durationMs)} caption="Active time, approvals excluded" />
      <MetricCard label="Tokens" value={totals.tokens == null ? UNKNOWN : totals.tokens.toLocaleString("en-US")}
        caption={u?.inputTokens != null && u.outputTokens != null
          ? <span className="ad-mono">{u.inputTokens.toLocaleString("en-US")} in · {u.outputTokens.toLocaleString("en-US")} out</span>
          : "Per-direction split unknown"} />
      <MetricCard label="Est. cost" value={formatCost(totals.costUsd)} caption="Estimated model cost" />
      <MetricCard label="Steps" value={<>{steps}<span className="text-(--ad-muted)"> / {run.maxModelCalls}</span></>}
        caption={`${totals.modelCalls} model · ${totals.toolCalls} tool calls`} />
      <MetricCard label="Errors" value={totals.errors} valueClassName={totals.errors ? "text-(--ad-error)" : undefined}
        caption={totals.errors ? (run.status === "completed" ? "Recovered, run succeeded" : "See the red steps") : "No errors"}
        className="col-span-2 md:col-span-1" />
    </div>
  );
}

export function ExportJsonButton({ run }: { run: RunDetail }) {
  return (
    <Button onClick={() => downloadFile(`run-${run.number ?? run.id}.json`, JSON.stringify({ ...run }, null, 2))}>Export JSON</Button>
  );
}
