"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchAgents,
  duplicateAgent,
  deleteAgent,
  type AgentSummary,
} from "./agents/_components/api";
import { TopNav } from "@/components/shell/top-nav";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlusIcon } from "@/components/ui/icons";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

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
    <WorkspaceShell>
      <TopNav />
      <main className="flex-1 p-4 sm:p-6">
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-semibold">Agents</h1>
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
                    <div className="mt-5 flex flex-wrap gap-2">
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
        </div>
      </main>
    </WorkspaceShell>
  );
}
