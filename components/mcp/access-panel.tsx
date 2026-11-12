"use client";
import { useState, type FormEvent } from "react";
type Key = { id: string; name: string; expiresAt: string; revokedAt: string | null; scope: unknown };
export function McpAccessPanel({ initial, endpoint, agents, tools }: { initial: Key[]; endpoint: string; agents: { id: string; name: string }[]; tools: { name: string; title: string; description: string }[] }) {
 const [keys, setKeys] = useState(initial), [secret, setSecret] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
 async function refresh() { const r = await fetch("/api/mcp/keys"); if (!r.ok) throw new Error(); setKeys((await r.json()).keys); }
 async function create(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();setBusy(true);setSecret(""); const form = event.currentTarget, data = new FormData(form);
  try { const r = await fetch("/api/mcp/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), expiresDays: Number(data.get("days")), agentIds: data.getAll("agent"), tools: data.getAll("tool") }) });
   const result = await r.json(); if (!r.ok) throw new Error(); setSecret(result.secret); await refresh(); form.reset(); setMessage("Access key created. Copy it now; it cannot be retrieved again.");
  } catch { setMessage("Could not create access. Select at least one owned agent and a read tool, and use a registered account."); }
  finally { setBusy(false); }
 }
 async function revoke(id: string) {
  setBusy(true);setSecret("");
  try { const r = await fetch("/api/mcp/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); if (!r.ok) throw new Error(); await refresh(); setMessage("Access revoked. Further requests using this key are denied."); }
  catch { setMessage("Could not revoke access. Reload and try again."); }
  finally { setBusy(false); }
 }
 return <section className="space-y-6 p-6"><h1 className="text-3xl font-semibold">Secure MCP access</h1><p className="max-w-3xl text-(--ad-muted)">Let an MCP client read selected agents’ names, release pointers and evaluation summaries. This connection cannot run agents, spend model credits, change configurations, approve actions or publish releases. Instructions, customer documents, answers and private checkpoints are excluded.</p>
 <p className="break-all text-sm">Endpoint: {endpoint}</p><p className="text-sm">Use Streamable HTTP with a manually configured Bearer token. Automatic OAuth discovery is not provided. HTTPS is required outside local development.</p>
 <form onSubmit={create} className="space-y-4 rounded-xl border border-(--ad-border) p-5"><h2 className="text-xl font-semibold">Grant limited read access</h2>
 <label className="block text-sm">Connection name<input required name="name" maxLength={80} className="ml-3 rounded border bg-(--ad-bg) p-2" /></label>
 <label className="block text-sm">Expires after<select name="days" className="ml-3 rounded border bg-(--ad-bg) p-2"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label>
 <fieldset className="space-y-2"><legend>Selected agents · up to 20</legend>{agents.map(a => <label key={a.id} className="flex gap-3 text-sm"><input name="agent" type="checkbox" value={a.id} />{a.name}</label>)}{!agents.length && <p>Create an agent before granting MCP access.</p>}</fieldset>
 <fieldset className="space-y-2"><legend>Allowed read tools</legend>{tools.map(t => <label key={t.name} className="flex gap-3 text-sm"><input name="tool" type="checkbox" value={t.name} /><span>{t.title}<span className="block text-xs text-(--ad-muted)">{t.description}</span></span></label>)}</fieldset>
 <p className="text-xs text-(--ad-muted)">Only grant this key to a client you trust with the selected metadata. Store it as a credential, not in agent instructions. The server keeps only its hash; access expires and can be revoked below.</p>
 <button disabled={busy || !agents.length} className="rounded-lg bg-(--ad-ice) px-4 py-2 text-(--ad-bg) disabled:opacity-50">Create scoped access key</button></form>
 <p role="status">{message}</p>{secret && <div className="space-y-3 rounded-xl border border-(--ad-border) p-4"><label className="block text-sm">Access key · shown once<input readOnly type="password" value={secret} autoComplete="off" className="mt-2 w-full rounded border bg-(--ad-bg) p-3" /></label><button className="underline" onClick={() => navigator.clipboard.writeText(secret).then(() => setMessage("Copied. Keep the key private."))}>Copy key</button><button className="ml-5 underline" onClick={() => setSecret("")}>Hide and forget</button></div>}
 <section className="space-y-3"><h2 className="text-xl font-semibold">Issued access keys</h2>{keys.map(k => <article key={k.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--ad-border) p-4"><div><p>{k.name}</p><p className="text-xs text-(--ad-muted)">{k.revokedAt ? "Revoked" : `Expires ${k.expiresAt}`}</p></div>{!k.revokedAt && <button disabled={busy} onClick={() => revoke(k.id)} className="text-sm underline">Revoke</button>}</article>)}</section>
 </section>;
}
