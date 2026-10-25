"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Backlit } from "@/components/ui/backlit";
import { Card } from "@/components/ui/card";
import { downloadFile } from "@/components/ui/cn";
import { ChevronRightIcon } from "@/components/ui/icons";
import { StatusPill, Tag, statusStyle } from "@/components/ui/pill";
import { formatCost, formatDuration, formatRelative, formatVersion, runLabel } from "@/lib/runs/format";
import type { RunSummary } from "@/lib/runs/queries";
import { emptyFilters, RunsFilters, type RunFilters } from "./runs-filters";

function toCsv(runs: RunSummary[]) {
  const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = runs.map(r => [r.number ?? r.id, r.agentName, formatVersion(r.version), r.input, statusStyle[r.status].label, r.durationMs, r.costUsd, r.tokens, r.startedAt]);
  return [["run", "agent", "version", "input", "status", "duration_ms", "est_cost_usd", "tokens", "started_at"], ...rows].map(r => r.map(cell).join(",")).join("\n");
}

/** Filter bar + history table. Filtering is client-side over the loaded page of runs. */
export function RunsTable({ runs: initialRuns, now, nextCursor: initialCursor }: { runs: RunSummary[]; now: number; nextCursor?: string | null }) {
  const [runs, setRuns] = useState(initialRuns);
  const [nextCursor, setNextCursor] = useState(initialCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  async function loadMore() {
    setLoading(true); setLoadError(null);
    try { const response = await fetch(`/api/runs?cursor=${encodeURIComponent(nextCursor!)}&limit=50`, { cache: "no-store" });
      if (!response.ok) throw new Error(); const page = await response.json();
      setRuns(previous => [...previous, ...page.runs]); setNextCursor(page.nextCursor);
    } catch { setLoadError("Could not load older runs."); } finally { setLoading(false); }
  }
  const router = useRouter();
  const [filters, setFilters] = useState<RunFilters>(emptyFilters);
  const agents = useMemo(() => [...new Map(runs.map(r => [r.agentId, { id: r.agentId, name: r.agentName }])).values()], [runs]);
  const shown = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return runs.filter(r => (!filters.agentId || r.agentId === filters.agentId) && (!filters.status || r.status === filters.status)
      && (!q || `${r.number} ${r.id} ${r.input} ${r.agentName}`.toLowerCase().includes(q)));
  }, [runs, filters]);

  return (
    <div className="space-y-5">
      <RunsFilters value={filters} onChange={setFilters} agents={agents} onExport={() => downloadFile("runs.csv", toCsv(shown), "text/csv")} />
      <p className="text-xs text-(--ad-muted)">Showing {runs.length} loaded runs. Filters apply to loaded history.</p>
      {nextCursor && <button type="button" onClick={loadMore} disabled={loading} className="rounded-lg border border-(--ad-border) px-4 py-2 text-sm">{loading ? "Loading…" : "Load older runs"}</button>}
      {loadError && <p role="alert" className="text-sm text-(--ad-error)">{loadError}</p>}
      <Backlit edge="top-right">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="ad-mono border-b border-(--ad-border) text-[11px] tracking-wider text-(--ad-muted) uppercase">
                <tr>
                  {["Run", "Agent", "Version", "Input", "Status", "Time", "Est. cost", "Started", ""].map((h, i) => (
                    <th key={i} scope="col" className={`px-5 py-4 font-medium ${i === 5 || i === 6 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} onClick={() => router.push(`/runs/${r.id}`)}
                    className="cursor-pointer border-b border-(--ad-border) last:border-0 hover:bg-(--ad-raised)">
                    <td className="ad-mono px-5 py-4 font-semibold">
                      <Link href={`/runs/${r.id}`} onClick={e => e.stopPropagation()} className="hover:underline">{runLabel(r.id, r.number)}</Link>
                    </td>
                    <td className="ad-mono px-5 py-4 text-[13px]">{r.agentName}</td>
                    <td className="px-5 py-4"><Tag>{formatVersion(r.version)}</Tag></td>
                    <td className="max-w-[320px] truncate px-5 py-4" title={r.input}>{r.input}</td>
                    <td className="px-5 py-4"><StatusPill status={r.status} /></td>
                    <td className="ad-mono px-5 py-4 text-right">{formatDuration(r.durationMs)}</td>
                    <td className="ad-mono px-5 py-4 text-right">{formatCost(r.costUsd)}</td>
                    <td className="px-5 py-4 whitespace-nowrap text-(--ad-muted)">{formatRelative(r.startedAt, now)}</td>
                    <td className="px-5 py-4 text-right text-(--ad-muted)"><ChevronRightIcon aria-label="View trace" /></td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr><td colSpan={9} className="px-5 py-12 text-center text-(--ad-muted)">No runs match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="ad-mono border-t border-(--ad-border) px-5 py-4 text-xs text-(--ad-muted)">
            Showing {shown.length} of {runs.length} runs
          </div>
        </Card>
      </Backlit>
    </div>
  );
}
