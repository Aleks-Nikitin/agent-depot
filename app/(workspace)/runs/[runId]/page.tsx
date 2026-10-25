import { AuthPrompt } from "@/components/auth/auth-prompt";
import { pageOwnerOrNull } from "@/lib/auth/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ExportJsonButton, RunStats } from "@/components/runs/run-stats";
import { TracePanel } from "@/components/trace/trace-panel";
import { Backlit } from "@/components/ui/backlit";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { AlertIcon, ClockIcon, RefreshIcon } from "@/components/ui/icons";
import { StatusPill, Tag } from "@/components/ui/pill";
import { deriveTrace } from "@/lib/playground/reduce-events";
import { describeReason, formatRelative, formatVersion, runLabel } from "@/lib/runs/format";
import { getRun } from "@/lib/runs/queries";

export const metadata: Metadata = { title: "Run detail · AgentDepot" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-(--ad-border) py-2.5 last:border-0">
      <dt className="text-sm text-(--ad-muted)">{label}</dt>
      <dd className="ad-mono min-w-0 truncate text-right text-[13px]">{children}</dd>
    </div>
  );
}

async function RunDetailContent({ params }: { params: Promise<{ runId: string }> }) {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return <AuthPrompt />;
  const { runId } = await params;
  const found = await getRun(ownerId, decodeURIComponent(runId));
  if (!found) notFound();
  const { run, now } = found;
  const trace = deriveTrace(run.events);
  const words = run.input.trim().split(/\s+/).length;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <nav aria-label="Breadcrumb" className="ad-mono text-[13px] text-(--ad-muted)">
          <Link href="/runs" className="hover:text-(--ad-text)">Runs</Link> / <span className="text-(--ad-text)">{runLabel(run.id, run.number)}</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-semibold">Run {runLabel(run.id, run.number)}</h1>
              <StatusPill status={run.status} />
            </div>
            <p className="ad-mono mt-1.5 text-[13px] text-(--ad-muted)">
              {run.agentName} · {formatVersion(run.version)} · {run.model} · started {formatRelative(run.startedAt, now)}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={`/agents/${run.agentId}/playground`}><RefreshIcon size={14} /> Re-run</ButtonLink>
            <ButtonLink href={`/agents/${run.agentId}/playground?runId=${encodeURIComponent(run.id)}`}>{run.status === "waiting_approval" ? "Review approval" : "Open saved run"}</ButtonLink>
            <ExportJsonButton run={run} />
          </div>
        </div>
      </div>

      <RunStats run={run} totals={trace.totals} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Input"><Tag className="ml-auto">query:text</Tag></CardHeader>
            <div className="p-5">
              <p className="ad-mono rounded-lg border border-(--ad-border) bg-(--ad-raised) p-4 text-sm leading-relaxed">&ldquo;{run.input}&rdquo;</p>
              <p className="ad-mono mt-3 flex justify-between text-xs text-(--ad-muted)">
                <span>{new Date(run.startedAt).toISOString().slice(11, 19)} UTC</span>
                <span>{words} words · {run.input.length} chars</span>
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Output"><Tag className="ml-auto">{trace.response ? "final answer" : "no answer"}</Tag></CardHeader>
            <div className="p-5">
              {trace.response ? (
                <p className="rounded-lg border border-(--ad-border) bg-(--ad-raised) p-4 text-[15px] leading-relaxed">{trace.response}</p>
              ) : run.status === "waiting_approval" ? (
                <div className="flex gap-2.5 rounded-lg border border-(--ad-approval-border) bg-(--ad-approval-bg) p-4 text-sm text-(--ad-approval)">
                  <ClockIcon className="mt-0.5 shrink-0" />
                  Paused for approval. No answer yet.
                </div>
              ) : (
                <div className="flex gap-2.5 rounded-lg border border-(--ad-error-border) bg-(--ad-error-bg) p-4 text-sm text-(--ad-error)">
                  <AlertIcon className="mt-0.5 shrink-0" />
                  {describeReason(trace.stopReason ?? "unknown")}. No answer was produced.
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Run metadata" />
            <dl className="px-5 py-2">
              <Row label="Run ID">{run.id}</Row>
              <Row label="Agent">{run.agentName} · {formatVersion(run.version)}</Row>
              <Row label="Model">{run.model}</Row>
              <Row label="Started">{new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 19)} UTC</Row>
              <Row label="Stop reason">{trace.stopReason ? describeReason(trace.stopReason) : "—"}</Row>
              <Row label="Events">{run.events.length}</Row>
            </dl>
          </Card>
        </div>

        <Backlit edge="right">
          <Card>
            <CardHeader title="Execution trace">
              <Tag>{run.events.length} events recorded</Tag>
            </CardHeader>
            <div className="p-5">
              <TracePanel trace={trace} model={run.model} now={now}
                emptyState={<p className="py-10 text-center text-sm text-(--ad-muted)">This run recorded no steps.</p>} />
            </div>
          </Card>
        </Backlit>
      </div>
    </div>
  );
}

export default function RunDetailPage({ params }: PageProps<"/runs/[runId]">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-(--ad-muted)">Loading run…</p>}>
      <RunDetailContent params={params} />
    </Suspense>
  );
}
