"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
type View = { ready: boolean; connection: { repository: string; revision: number; enabled: boolean; allowWrites: boolean } | null;
  operations: { key: string; runId: string; repository: string; status: string; reason: string | null; result: unknown }[] };
export function GitHubPanel() {
  const [view, setView] = useState<View | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch("/api/connectors/github"); if (!response.ok) throw new Error();
    setView(await response.json());
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/connectors/github").then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<View>; })
      .then(data => { if (active) setView(data); }).catch(() => { if (active) setMessage("Could not load GitHub connection."); });
    return () => { active = false; };
  }, []);
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const form = event.currentTarget; const data = new FormData(form);
    try {
      const response = await fetch("/api/connectors/github", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: data.get("repository"), token: data.get("token"), allowWrites: data.get("writes") === "on" }) });
      form.reset(); if (!response.ok) throw new Error();
      await refresh(); setMessage("Connected. Open an agent’s Connections tab to enable access. Reconnecting invalidates its previous binding.");
    } catch { form.reset(); setMessage("Could not connect. Check repository access, token permissions and server encryption setup."); }
    finally { setBusy(false); }
  }
  async function act(key?: string) {
    setBusy(true);
    try {
      const response = await fetch(key ? "/api/connectors/github/reconcile" : "/api/connectors/github", { method: key ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, ...(key ? { body: JSON.stringify({ key }) } : {}) });
      if (!response.ok) throw new Error(); await refresh(); setMessage(key ? "Reconciliation checked. Unknown means no exact match was established; inspect GitHub before making another request." : "Disconnected. Stored credentials were erased.");
    } catch { setMessage("Could not complete the action. Check connection access and try again."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border border-(--ad-border) p-5"><h2 className="text-xl font-semibold">GitHub issue triage</h2>
    <p className="text-sm text-(--ad-muted)">Connect one repository with a separate fine-grained token. Restrict it to that repository and Issues read access; select read/write only for reviewed issue creation. Login with GitHub does not grant this access.</p>
    {view?.connection?.enabled && <p>Connected: {view.connection.repository} · revision {view.connection.revision} · {view.connection.allowWrites ? "Reviewed writes allowed" : "Read only"} <button type="button" disabled={busy} onClick={() => act()} className="ml-3 underline">Disconnect</button></p>}
    {view && !view.ready && <p role="status">Server setup required: configure CONNECTOR_ENCRYPTION_KEY before connecting.</p>}
    <form onSubmit={connect} className="space-y-3">
      <label className="block">Repository<input name="repository" required placeholder="owner/repository" maxLength={140} className="ml-3 rounded border p-2" /></label>
      <label className="block">Fine-grained token<input name="token" type="password" required autoComplete="off" maxLength={500} className="ml-3 rounded border p-2" /></label>
      <label className="flex gap-3"><input name="writes" type="checkbox" />Allow proposing issues for human approval</label>
      <button type="submit" disabled={busy || !view?.ready} className="rounded-lg bg-(--ad-ice) px-4 py-2 text-(--ad-bg) disabled:opacity-50">{busy ? "Working…" : "Connect or rotate token"}</button>
    </form>
    <p role="status" className="text-sm">{message}</p>
    {!!view?.operations.length && <div className="space-y-3"><h3 className="font-semibold">Recent issue operations</h3>{view.operations.map(op => <article key={op.key} className="rounded border border-(--ad-border) p-3 text-sm"><p>{op.repository} · {op.status}</p><Link className="underline" href={`/runs/${encodeURIComponent(op.runId)}`}>View execution evidence</Link>{op.status === "unknown" && <button type="button" disabled={busy} onClick={() => act(op.key)} className="ml-4 underline">Check GitHub for completion</button>}</article>)}</div>}
  </section>;
}
