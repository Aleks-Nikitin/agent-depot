import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import type { QualitySummary } from "@/lib/evals/types";
import { UNKNOWN } from "@/lib/runs/format";

const pct = (v: number | null) => (v == null ? UNKNOWN : `${Math.round(v * 100)}%`);

export function QualityCard({ version, passRate, quality }: { version: number; passRate: number | null; quality: QualitySummary }) {
  const worse = passRate != null && quality.previousPassRate != null && passRate < quality.previousPassRate;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Agent quality</h2>
        {quality.previousVersion != null && <span className="ad-mono text-xs text-(--ad-muted)">v{quality.previousVersion} vs v{version}</span>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-(--ad-border) bg-(--ad-raised) p-4">
          <p className="ad-mono text-[11px] tracking-wider text-(--ad-muted) uppercase">Pass rate (v{version})</p>
          <p className={cn("ad-mono mt-2 text-2xl font-semibold", worse ? "text-(--ad-error)" : "text-(--ad-success)")}>{pct(passRate)}</p>
          {quality.previousVersion != null && <p className="mt-1 text-[13px] text-(--ad-muted)">vs {pct(quality.previousPassRate)} in v{quality.previousVersion}</p>}
        </div>
        <div className="rounded-lg border border-(--ad-border) bg-(--ad-raised) p-4">
          <p className="ad-mono text-[11px] tracking-wider text-(--ad-muted) uppercase">Tool errors</p>
          <p className={cn("ad-mono mt-2 text-2xl font-semibold", quality.toolErrors > 0 && "text-(--ad-error)")}>{passRate === null ? UNKNOWN : quality.toolErrors}</p>
          <p className="mt-1 text-[13px] text-(--ad-muted)">{passRate === null ? "Run tests to measure" : "recorded tool failures, including denied writes"}</p>
        </div>
      </div>
      {quality.mostCommonFailure && (
        <div className="mt-3 rounded-lg border border-(--ad-border) bg-(--ad-raised) p-4">
          <p className="ad-mono text-[11px] tracking-wider text-(--ad-muted) uppercase">Most common failure</p>
          <p className="mt-2 flex items-center gap-2 text-sm"><span className="h-1.5 w-1.5 rounded-full bg-(--ad-error)" aria-hidden="true" />{quality.mostCommonFailure}</p>
        </div>
      )}
      <p className="mt-4 text-xs text-(--ad-muted)">Passing these saved checks is release evidence; it does not certify enterprise readiness.</p>
    </Card>
  );
}
