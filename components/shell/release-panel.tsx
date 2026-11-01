"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReleasePanel({ agentId, servingReleaseId, generation, releases }: {
  agentId: string; servingReleaseId: string | null; generation: number;
  releases: { id: string; version: number; createdAt: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function rollback(releaseId: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/releases/rollback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId, expectedGeneration: generation }),
      });
      if (!response.ok) throw new Error();
      setMessage("Serving release restored. Draft is unchanged."); router.refresh();
    } catch { setMessage("Could not restore the serving release. Refresh and try again."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 border-b border-(--ad-border) p-6">
    <h2 className="text-xl font-semibold">Serving releases</h2>
    <p className="text-sm text-(--ad-muted)">Approved artifacts serve independently of draft edits. Restore a prior release with its saved evaluation evidence.</p>
    {!releases.length && <p>No approved release yet. Run tests and publish a draft first.</p>}
    {releases.map(release => <div key={release.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--ad-border) p-3">
      <span>v{release.version}{servingReleaseId === release.id ? " · serving" : " · approved"} <span className="text-xs text-(--ad-muted)">{release.createdAt}</span></span>
      <button type="button" disabled={busy || servingReleaseId === release.id} onClick={() => void rollback(release.id)} className="rounded-lg border border-(--ad-border) px-3 py-2 text-sm disabled:opacity-40">Restore serving release</button>
    </div>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
