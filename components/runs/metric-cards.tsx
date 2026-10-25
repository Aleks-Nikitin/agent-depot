import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { CheckIcon, ClockIcon, LockIcon, SparkIcon } from "@/components/ui/icons";
import type { RunMetrics } from "@/lib/runs/metrics";
import { formatCost, formatDuration, UNKNOWN } from "@/lib/runs/format";

export function MetricCard({ label, value, caption, icon, valueClassName, className }: {
  label: string; value: ReactNode; caption?: ReactNode; icon?: ReactNode; valueClassName?: string; className?: string;
}) {
  return (
    <Card className={cn("flex flex-col p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="ad-mono text-[11px] font-medium tracking-wider text-(--ad-muted) uppercase">{label}</span>
        {icon && <span className="text-(--ad-muted)">{icon}</span>}
      </div>
      <div className={cn("ad-mono mt-3 text-[28px] leading-none font-semibold", valueClassName)}>{value}</div>
      {caption && <div className="mt-3 text-[13px] text-(--ad-muted)">{caption}</div>}
    </Card>
  );
}

export function MetricCards({ metrics }: { metrics: RunMetrics }) {
  const rate = metrics.successRate == null ? UNKNOWN : `${Math.round(metrics.successRate * 100)}%`;
  return (
    <>
      <MetricCard label="Success rate" icon={<CheckIcon />} value={rate} valueClassName="text-(--ad-success)"
        caption={<><span className="ad-mono">{metrics.succeeded}/{metrics.finished}</span> · succeeded ÷ finished runs</>} />
      <MetricCard label="Avg time" icon={<ClockIcon />} value={formatDuration(metrics.avgDurationMs)}
        caption="Active time per finished run" />
      <MetricCard label="Avg est. cost" icon={<SparkIcon />} value={formatCost(metrics.avgCostUsd)}
        caption="Estimated model cost per run" />
      <MetricCard label="Pending approvals" icon={<LockIcon />} value={metrics.pendingApprovals}
        valueClassName={metrics.pendingApprovals ? "text-(--ad-approval)" : undefined}
        caption={metrics.pendingApprovals ? <span className="text-(--ad-approval)">Waiting for a human</span> : "Nothing waiting"} />
    </>
  );
}
