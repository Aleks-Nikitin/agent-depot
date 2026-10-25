"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  fetchAgents,
  duplicateAgent,
  deleteAgent,
  type AgentSummary,
} from "./agents/_components/api";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlusIcon } from "@/components/ui/icons";
import type { RunSummary } from "@/lib/runs/queries";
import { computeMetrics } from "@/lib/runs/metrics";
import { formatCost, formatDuration } from "@/lib/runs/format";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

export default function Dashboard({ initialAgents, recentRuns }: { initialAgents: AgentSummary[]; recentRuns: RunSummary[] }) {
  const [agents, setAgents] = useState<AgentSummary[] | null>(initialAgents);
  const metrics = computeMetrics(recentRuns);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAgents(await fetchAgents());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents.");
    }
  }, []);

  const onDuplicate = async (id: string) => {
    setBusy(id);
    try {
      await duplicateAgent(id);
      await load();
    } catch {
      setError("Could not update this agent. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(id);
    try {
      await deleteAgent(id);
      await load();
    } catch {
      setError("Could not update this agent. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <WorkspaceShell>
      <main className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-8">
          <section className="relative isolate overflow-hidden rounded-3xl border border-(--ad-border) bg-[radial-gradient(ellipse_at_85%_25%,#f4efe3_0%,#ece9e0_45%,#e3dccb_78%)] px-6 py-10 sm:px-10 lg:py-14">
            <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-96 w-96 rounded-full border border-[#b2552f1a] shadow-[0_0_110px_35px_#b2552f10]" />
            <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
              <div>
                <p className="ad-mono text-[11px] uppercase tracking-[0.24em] text-[#b2552f]">AgentDepot / powered by Gemini</p>
                <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.12] tracking-tight text-(--ad-text) sm:text-5xl">From an idea.<br /><span className="text-[#b2552f]">To an agent you can inspect.</span></h1>
                <p className="mt-5 max-w-lg text-sm leading-7 text-(--ad-muted)">Give it a goal. Choose its tools. Test every revision, approve sensitive actions, and follow every execution in one workspace.</p>
                <div className="mt-7 flex flex-wrap gap-3"><ButtonLink href="/agents/new" variant="primary"><PlusIcon size={14} /> Build an agent</ButtonLink><ButtonLink href="/tools" variant="secondary">Explore tools →</ButtonLink></div>
                <p className="mt-5 text-xs text-(--ad-muted)">Reusable configurations · Human approvals · Saved execution traces</p>
              </div>
              <div aria-label="Agent workflow" className="relative space-y-3 lg:pl-5">
                {([
                  ["01", "Define the job", "Instructions + permitted tools", "Draft a spec with Gemini"],
                  ["02", "Prove the behavior", "Saved checks + execution evidence", "Test before publishing"],
                  ["03", "Stay in control", "Approve writes + inspect history", "Every step leaves a trace"],
                ] as const).map(([number, title, description, caption]) => <div key={number} className="flex items-center gap-4 rounded-xl border border-(--ad-border) bg-(--ad-surface) px-5 py-4 shadow-sm">
                  <span className="ad-mono text-xs text-(--ad-model)">{number}</span><div><h2 className="text-sm font-semibold text-(--ad-text)">{title}</h2><p className="mt-1 text-xs text-(--ad-muted)">{description}</p></div><span className="ml-auto hidden max-w-28 text-right text-[10px] text-(--ad-muted) sm:block">{caption}</span>
                </div>)}
              </div>
            </div>
          </section>
          <section aria-label="Workspace activity" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[["Saved agents", String(agents?.length ?? 0)], ["Recent executions", String(recentRuns.length)], ["Success rate", metrics.successRate === null ? "—" : `${Math.round(metrics.successRate * 100)}%`], ["Waiting for approval", String(metrics.pendingApprovals)]].map(([label, value]) => <Card key={label} className="p-5"><p className="text-xs text-(--ad-muted)">{label}</p><p className="ad-mono mt-3 text-2xl font-semibold">{value}</p></Card>)}
          </section>
          <p className="text-xs text-(--ad-muted)">Activity covers the latest {recentRuns.length} playground runs (up to 50). Success rate uses finished runs; test suites appear in Tests.</p>
          <section className="grid gap-4 sm:grid-cols-2" aria-label="Starter templates">
            <Link href="/agents/new?template=acmestore-support" className="rounded-xl border border-(--ad-border) p-5 transition-colors hover:bg-(--ad-raised)"><p className="ad-mono text-[10px] uppercase tracking-widest text-(--ad-model)">Support template</p><h2 className="mt-2 font-semibold">Answers grounded in your policies</h2><p className="mt-2 text-sm text-(--ad-muted)">Knowledge search, manager-review approvals, and three saved checks. Start here →</p></Link>
            <Link href="/agents/new?template=competitor-pricing-analyst" className="rounded-xl border border-(--ad-border) p-5 transition-colors hover:bg-(--ad-raised)"><p className="ad-mono text-[10px] uppercase tracking-widest text-(--ad-model)">Pricing template</p><h2 className="mt-2 font-semibold">Turn sales figures into decisions</h2><p className="mt-2 text-sm text-(--ad-muted)">Prepared sales data, competitor lookup, and three saved checks. Start here →</p></Link>
          </section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[22px] font-semibold">Your agents</h2>
              <p className="mt-1 text-sm text-(--ad-muted)">
                Configure, version, and publish reusable AI agents.
              </p>
            </div>
            <ButtonLink href="/agents/new" variant="primary">
              <PlusIcon size={14} />
              New Agent
            </ButtonLink>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-(--ad-error-border) bg-(--ad-error-bg) px-5 py-4 text-sm text-(--ad-error)"
            >
              {error}
            </div>
          )}

          {agents === null && !error && (
            <p className="text-sm text-(--ad-muted)">Loading agents…</p>
          )}

          {agents && agents.length === 0 && (
            <Card className="border-dashed px-6 py-12 text-center">
              <p className="text-(--ad-text)">No agents yet.</p>
              <p className="mt-1 text-sm text-(--ad-muted)">
                Create one from a template or draft it with Gemini.
              </p>
              <ButtonLink
                href="/agents/new"
                variant="secondary"
                className="mt-4"
              >
                <PlusIcon size={14} />
                Create your first agent
              </ButtonLink>
            </Card>
          )}

          {agents && agents.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <Card className="h-full p-5 transition-colors hover:border-(--ad-muted)/50">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/agents/${agent.id}`}
                        className="min-w-0 truncate font-semibold hover:text-(--ad-ice)"
                      >
                        {agent.name}
                      </Link>
                      {agent.published ? (
                        <span className="shrink-0 rounded-full border border-(--ad-success-border) bg-(--ad-success-bg) px-2.5 py-1 text-[11px] font-medium text-(--ad-success)">
                          Published v{agent.publishedVersion}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full border border-(--ad-border) bg-(--ad-raised) px-2.5 py-1 text-[11px] font-medium text-(--ad-muted)">
                          Draft
                        </span>
                      )}
                    </div>
                    <p className="ad-mono mt-2 text-xs text-(--ad-muted)">
                      v{agent.version} · {agent.enabledTools.length} tool
                      {agent.enabledTools.length === 1 ? "" : "s"} ·{" "}
                      {new Date(agent.updatedAt).toLocaleString()}
                    </p>
                    <p className="mt-3 text-xs text-(--ad-muted)">{(() => { const last = recentRuns.find(run => run.agentId === agent.id); return last ? `Last run: ${last.status.replaceAll("_", " ")} · ${formatDuration(last.durationMs)} · ${formatCost(last.costUsd)}` : "No playground runs in the recent history."; })()}</p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <ButtonLink href={`/agents/${agent.id}/playground`} variant="primary" size="sm">Run</ButtonLink>
                      <ButtonLink href={`/agents/${agent.id}/tests`} size="sm">Tests</ButtonLink>
                      <ButtonLink
                        href={`/agents/${agent.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Edit
                      </ButtonLink>
                      <Button
                        onClick={() => onDuplicate(agent.id)}
                        disabled={busy === agent.id}
                        size="sm"
                      >
                        Duplicate
                      </Button>
                      <Button
                        onClick={() => onDelete(agent.id, agent.name)}
                        disabled={busy === agent.id}
                        variant="danger"
                        size="sm"
                      >
                        Delete
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {recentRuns.length > 0 && <section aria-label="Recent execution history" className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Recent activity</h2><Link href="/runs" className="text-sm text-(--ad-model)">All runs →</Link></div><div className="divide-y divide-(--ad-border) rounded-xl border border-(--ad-border)">{recentRuns.slice(0, 5).map(run => <Link key={run.id} href={run.status === "waiting_approval" ? `/agents/${run.agentId}/playground?runId=${run.id}` : `/runs/${run.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-(--ad-raised)"><div><p className="text-sm font-medium">{run.agentName}</p><p className="mt-1 max-w-xl truncate text-xs text-(--ad-muted)">{run.input}</p></div><span className={run.status === "waiting_approval" ? "text-sm text-amber-200" : "text-sm text-(--ad-muted)"}>{run.status === "waiting_approval" ? "Review approval →" : run.status.replaceAll("_", " ")}</span></Link>)}</div></section>}
        </div>
      </main>
    </WorkspaceShell>
  );
}
