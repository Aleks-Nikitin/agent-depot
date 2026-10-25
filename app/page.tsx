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
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-text">Agents</h1>
          <p className="mt-0.5 text-[12px] text-muted">
            Configure, version, and publish reusable AI agents.
          </p>
        </div>
        <Link
          href="/agents/new"
          className="flex h-[34px] items-center gap-1.5 rounded-[6px] bg-primary px-3 text-[12px] font-medium text-primary-text hover:brightness-95"
        >
          <span className="text-[13px] leading-none">＋</span> New agent
        </Link>
      </div>

      {error && (
        <div className="rounded-[6px] border border-pending/30 bg-pending/10 px-3 py-2 text-[12px] text-pending">
          {error}
        </div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
          tone="pending"
        />
        <Metric label="Tools In Use" value={metrics.tools} hint="distinct connectors" />

        {/* Mini status panel */}
        <div className="rounded-[6px] border border-border bg-panel p-3">
          <div className="flex items-center justify-between">
            <span className="label-mono">Published Ratio</span>
            <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-mono text-[10px] text-success">
              {publishedPct}%
            </span>
          </div>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-success"
              style={{ width: `${publishedPct}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted">
            {metrics.published}/{metrics.total} published
          </p>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border bg-panel p-2">
        <div className="flex h-[32px] flex-1 items-center gap-2 rounded-[6px] border border-border bg-surface px-2.5">
          <span className="text-muted">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents…"
            className="w-full bg-transparent text-[12px] text-text outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-[32px] rounded-[6px] border border-border bg-surface px-2 text-[12px] text-text outline-none"
        >
          <option value="all">All status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <button
          onClick={exportJson}
          className="h-[32px] rounded-[6px] border border-border bg-surface px-3 text-[12px] text-muted hover:text-text"
        >
          Export
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[6px] border border-border">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-panel">
              {["Name", "ID", "Version", "Tools", "Status", "Updated", ""].map((h) => (
                <th
                  key={h}
                  className="label-mono px-3 py-2 text-left font-normal"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents === null && !error && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[12px] text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {agents && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-[12px] text-muted">
                  No agents match. Create one from a template or draft it with Gemini.
                </td>
              </tr>
            )}
            {filtered.map((agent) => (
              <tr
                key={agent.id}
                onClick={() => router.push(`/agents/${agent.id}`)}
                className="h-[44px] cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface/50"
              >
                <td className="px-3 text-[12px] text-text">{agent.name}</td>
                <td className="px-3 font-mono text-[11px] text-muted">
                  {agent.id.slice(0, 8)}
                </td>
                <td className="px-3">
                  <span className="rounded-[4px] border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">
                    v{agent.version}
                  </span>
                </td>
                <td className="px-3 font-mono text-[11px] text-muted">
                  {agent.enabledTools.length}
                </td>
                <td className="px-3">
                  <StatusPill
                    published={agent.published}
                    publishedVersion={agent.publishedVersion}
                  />
                </td>
                <td className="px-3 font-mono text-[11px] text-muted">
                  {new Date(agent.updatedAt).toLocaleDateString()}
                </td>
                <td className="px-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5">
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
  tone?: "success" | "pending";
}) {
  const color =
    tone === "success" ? "text-success" : tone === "pending" ? "text-pending" : "text-text";
  return (
    <div className="rounded-[6px] border border-border bg-panel p-3">
      <span className="label-mono">{label}</span>
      <div className={`mt-2 font-mono text-[26px] font-bold leading-none ${color}`}>
        {value}
      </div>
      <p className="mt-2 text-[11px] text-muted">{hint}</p>
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
      <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 font-mono text-[10px] text-success">
        <span className="h-1 w-1 rounded-full bg-success" />
        published v{publishedVersion}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-pending/12 px-2 py-0.5 font-mono text-[10px] text-pending">
      <span className="h-1 w-1 rounded-full bg-pending" />
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
      className={`rounded-[5px] border border-border bg-surface px-2 py-1 text-[11px] hover:border-muted disabled:opacity-40 ${
        danger ? "text-pending" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
