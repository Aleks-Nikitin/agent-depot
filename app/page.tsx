"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  fetchAgents,
  duplicateAgent,
  deleteAgent,
  type AgentSummary,
} from "./agents/_components/api";

type StatusFilter = "all" | "published" | "draft";

export default function Dashboard() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const load = useCallback(async () => {
    try {
      setAgents(await fetchAgents());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents.");
    }
  }, []);

  useEffect(() => {
    // Syncs server state into React after an await; not a synchronous render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const onDuplicate = async (id: string) => {
    setBusy(id);
    try {
      await duplicateAgent(id);
      await load();
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
    } finally {
      setBusy(null);
    }
  };

  const metrics = useMemo(() => {
    const list = agents ?? [];
    const published = list.filter((a) => a.published).length;
    const tools = new Set(list.flatMap((a) => a.enabledTools)).size;
    return {
      total: list.length,
      published,
      drafts: list.length - published,
      tools,
    };
  }, [agents]);

  const filtered = useMemo(() => {
    const list = agents ?? [];
    return list.filter((a) => {
      const matchesQuery = a.name.toLowerCase().includes(query.trim().toLowerCase());
      const matchesStatus =
        status === "all" ||
        (status === "published" ? a.published : !a.published);
      return matchesQuery && matchesStatus;
    });
  }, [agents, query, status]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agents.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const publishedPct =
    metrics.total === 0 ? 0 : Math.round((metrics.published / metrics.total) * 100);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-mono mb-2">{"// Workspace"}</p>
          <h1 className="font-serif text-[44px] leading-none">Agents.</h1>
          <p className="mt-3 text-[16px] italic text-muted">
            Configure, version, and publish reusable AI agents.
          </p>
        </div>
        <Link
          href="/agents/new"
          className="mono rounded-full bg-ink px-5 py-3 text-[12px] font-medium tracking-[0.12em] text-paper hover:bg-ink/90"
        >
          [ NEW AGENT → ]
        </Link>
      </div>

      {error && (
        <div className="rounded-[10px] border border-accent/40 bg-accent/10 px-4 py-2.5 text-[13px] text-accent">
          {error}
        </div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Total Agents" value={metrics.total} hint="in this workspace" />
        <Metric
          label="Published"
          value={metrics.published}
          hint="production-ready"
          tone="success"
        />
        <Metric
          label="Drafts"
          value={metrics.drafts}
          hint="not yet published"
          tone="accent"
        />
        <Metric label="Tools In Use" value={metrics.tools} hint="distinct connectors" />
      </div>

      {/* Published ratio bar */}
      <div className="rounded-[10px] border border-line bg-panel px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="label-mono">Published Ratio</span>
          <span className="mono text-[12px] text-success">{publishedPct}%</span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${publishedPct}%` }}
          />
        </div>
        <p className="mono mt-2 text-[12px] text-muted">
          {metrics.published}/{metrics.total} published
        </p>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-[44px] flex-1 items-center gap-2 rounded-full border border-line bg-panel px-4">
          <span className="text-muted">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search agents…"
            className="w-full bg-transparent text-[14px] text-ink outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="mono h-[44px] rounded-full border border-line bg-panel px-4 text-[12px] text-ink outline-none"
        >
          <option value="all">ALL STATUS</option>
          <option value="published">PUBLISHED</option>
          <option value="draft">DRAFT</option>
        </select>
        <button
          onClick={exportJson}
          className="mono h-[44px] rounded-full border border-line bg-panel px-5 text-[12px] tracking-[0.1em] text-muted hover:text-ink"
        >
          EXPORT
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[10px] border border-line bg-panel">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              {["Name", "ID", "Version", "Tools", "Status", "Updated", ""].map((h) => (
                <th key={h} className="label-mono px-5 py-3 text-left font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents === null && !error && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center italic text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {agents && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center italic text-muted">
                  No agents match. Create one from a template or draft it with Gemini.
                </td>
              </tr>
            )}
            {filtered.map((agent) => (
              <tr
                key={agent.id}
                onClick={() => router.push(`/agents/${agent.id}`)}
                className="h-[54px] cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised/50"
              >
                <td className="px-5 text-[15px] text-ink">{agent.name}</td>
                <td className="px-5 mono text-[12px] text-muted">
                  {agent.id.slice(0, 8)}
                </td>
                <td className="px-5">
                  <span className="mono rounded-[5px] border border-line bg-raised px-2 py-0.5 text-[11px] text-muted">
                    v{agent.version}
                  </span>
                </td>
                <td className="px-5 mono text-[12px] text-muted">
                  {agent.enabledTools.length}
                </td>
                <td className="px-5">
                  <StatusPill
                    published={agent.published}
                    publishedVersion={agent.publishedVersion}
                  />
                </td>
                <td className="px-5 mono text-[12px] text-muted">
                  {new Date(agent.updatedAt).toLocaleDateString()}
                </td>
                <td className="px-5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-2">
                    <RowButton onClick={() => onDuplicate(agent.id)} disabled={busy === agent.id}>
                      Duplicate
                    </RowButton>
                    <RowButton
                      onClick={() => onDelete(agent.id, agent.name)}
                      disabled={busy === agent.id}
                      danger
                    >
                      Delete
                    </RowButton>
                    <span className="pl-1 text-muted">›</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "success" | "accent";
}) {
  const color =
    tone === "success" ? "text-success" : tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="rounded-[10px] border border-line bg-panel px-5 py-4">
      <span className="label-mono">{label}</span>
      <div className={`mt-3 font-serif text-[40px] leading-none ${color}`}>{value}</div>
      <p className="mt-3 text-[13px] italic text-muted">{hint}</p>
    </div>
  );
}

function StatusPill({
  published,
  publishedVersion,
}: {
  published: boolean;
  publishedVersion: number | null;
}) {
  if (published) {
    return (
      <span className="mono inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-[11px] text-success">
        <span className="h-1 w-1 rounded-full bg-success" />
        published v{publishedVersion}
      </span>
    );
  }
  return (
    <span className="mono inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] text-accent">
      <span className="h-1 w-1 rounded-full bg-accent" />
      draft
    </span>
  );
}

function RowButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`mono rounded-full border border-line bg-paper px-3 py-1 text-[11px] hover:border-muted disabled:opacity-40 ${
        danger ? "text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
