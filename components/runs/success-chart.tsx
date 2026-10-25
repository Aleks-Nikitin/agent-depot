import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";

type Point = { id: string; ok: boolean; rate: number };

/** Running success rate over the latest finished runs. Hand-rolled SVG (PLACEHOLDER(P15): no chart library yet). */
export function SuccessChart({ series, className }: { series: Point[]; className?: string }) {
  const ok = series.filter(p => p.ok).length;
  const W = 300, H = 72, pad = 6;
  const x = (i: number) => (series.length < 2 ? W / 2 : (i / (series.length - 1)) * W);
  const y = (rate: number) => pad + (1 - rate) * (H - pad * 2);
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");
  const area = series.length ? `${line} L${x(series.length - 1)},${H} L${x(0)},${H} Z` : "";

  return (
    <Card className={className ?? "flex flex-col p-5"}>
      <div className="flex items-center justify-between gap-2">
        <span className="ad-mono text-[11px] font-medium tracking-wider text-(--ad-muted) uppercase">Run performance</span>
        {series.length > 0 && <Pill tone="success" className="ad-mono">{Math.round((ok / series.length) * 100)}% pass</Pill>}
      </div>
      <div className="mt-2 flex items-center justify-between text-[13px] text-(--ad-muted)">
        <span>Success rate (last {series.length} runs)</span>
        <span className="ad-mono">{ok}/{series.length} OK</span>
      </div>
      {series.length ? (
        <div className="relative mt-3 h-[72px]">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" role="img"
            aria-label={`Running success rate across ${series.length} runs, ending at ${Math.round(series[series.length - 1].rate * 100)}%`}>
            <defs>
              <linearGradient id="ad-chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#92c4a0" stopOpacity="0.22" />
                <stop offset="1" stopColor="#92c4a0" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#ad-chart-fill)" />
            <path d={line} fill="none" stroke="#92c4a0" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          {series.map((p, i) => (!p.ok || i === series.length - 1) && (
            <span key={p.id} title={p.ok ? "latest" : "failed run"}
              className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${p.ok ? "border-(--ad-success) bg-(--ad-success)" : "border-(--ad-error) bg-(--ad-bg)"}`}
              style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.rate) / H) * 100}%` }} />
          ))}
        </div>
      ) : (
        <p className="mt-6 text-sm text-(--ad-muted)">No finished runs yet.</p>
      )}
    </Card>
  );
}
