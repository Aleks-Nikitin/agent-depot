import { cn } from "@/components/ui/cn";
import type { TraceTotals as Totals } from "@/lib/playground/reduce-events";
import { formatCost, formatDuration, formatTokens } from "@/lib/runs/format";

/** "1,204 tok · $0.0019 · 1.6s". Unknown values say "unknown". */
export function TraceTotals({ totals, className }: { totals: Totals; className?: string }) {
  return (
    <span className={cn("ad-mono text-[13px] text-(--ad-muted)", className)}>
      {formatTokens(totals.tokens)} · {formatCost(totals.costUsd)} · {formatDuration(totals.durationMs)}
    </span>
  );
}
