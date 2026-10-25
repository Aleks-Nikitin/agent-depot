"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchAgents,
  duplicateAgent,
  deleteAgent,
  type AgentSummary,
} from "./agents/_components/api";

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
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

  useEffect(() => {
    // load() awaits the server before any setState, so this syncs external
    // (server) state into React — not a synchronous cascading render.
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

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Configure, version, and publish reusable AI agents.
          </p>
        </div>
        <Link
          href="/agents/new"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
        >
          New Agent
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {agents === null && !error && (
        <p className="text-sm text-zinc-500">Loading…</p>
      )}

      {agents && agents.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/15 px-6 py-12 text-center">
          <p className="text-zinc-300">No agents yet.</p>
          <p className="mt-1 text-sm text-zinc-500">
            Create one from a template or draft it with Gemini.
          </p>
          <Link
            href="/agents/new"
            className="mt-4 inline-block rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
          >
            Create your first agent
          </Link>
        </div>
      )}

      {agents && agents.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/agents/${agent.id}`}
                  className="font-medium hover:underline"
                >
                  {agent.name}
                </Link>
                {agent.published ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                    Published v{agent.publishedVersion}
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs text-zinc-400">
                    Draft
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                v{agent.version} · {agent.enabledTools.length} tool
                {agent.enabledTools.length === 1 ? "" : "s"} ·{" "}
                {new Date(agent.updatedAt).toLocaleString()}
              </p>
              <div className="mt-3 flex gap-2 text-sm">
                <Link
                  href={`/agents/${agent.id}`}
                  className="rounded-md border border-white/15 px-3 py-1 hover:bg-white/10"
                >
                  Edit
                </Link>
                <button
                  onClick={() => onDuplicate(agent.id)}
                  disabled={busy === agent.id}
                  className="rounded-md border border-white/15 px-3 py-1 hover:bg-white/10 disabled:opacity-50"
                >
                  Duplicate
                </button>
                <button
                  onClick={() => onDelete(agent.id, agent.name)}
                  disabled={busy === agent.id}
                  className="rounded-md border border-red-500/30 px-3 py-1 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
