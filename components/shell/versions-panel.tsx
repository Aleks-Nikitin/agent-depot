"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rollbackAgent } from "@/app/agents/_components/api";

export function VersionsPanel({ agentId, currentVersion, versions }: { agentId: string; currentVersion: number;
  versions: { version: number; name: string; createdAt: string; published: boolean; spec: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function restore(version: number) {
    setBusy(version); setMessage(null);
    try { const restored = await rollbackAgent(agentId, version); setMessage(`Restored v${version} as v${restored.version}. Run tests before publishing.`); router.refresh(); }
    catch { setMessage("Could not restore this version. Try again."); } finally { setBusy(null); }
  }
  return <section className="space-y-5 p-6">
    <h2 className="text-xl font-semibold">Version history</h2>
    <p className="text-sm text-(--ad-muted)">Restoring a version creates a new revision and preserves history.</p>
    {message && <p role="status">{message}</p>}
    {versions.map(version => <article key={version.version} className="rounded-xl border border-(--ad-border) bg-(--ad-surface) p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">v{version.version} · {version.name}{version.version === currentVersion ? " · current" : ""}{version.published ? " · published" : ""}</h3>
        <button type="button" disabled={busy !== null || version.version === currentVersion} onClick={() => restore(version.version)} className="rounded-lg border border-(--ad-border) px-3 py-2 text-sm disabled:opacity-40">{busy === version.version ? "Restoring…" : "Restore version"}</button></div>
      <p className="mt-2 text-xs text-(--ad-muted)">{version.createdAt}</p>
      <details className="mt-4"><summary className="cursor-pointer text-sm text-(--ad-model)">View saved specification</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-(--ad-bg) p-4 text-xs">{version.spec}</pre></details>
    </article>)}
  </section>;
}
