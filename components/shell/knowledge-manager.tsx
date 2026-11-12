"use client";
import { useState, type FormEvent } from "react";

type Document = { id: string; title: string; text: string; version?: number; sourceName?: string | null; access?: string; agentIds?: string[] };
type Revision = { version: number; title: string; sourceName: string | null; contentHash: string };
const field = "mt-2 w-full rounded-lg border border-(--ad-border) bg-(--ad-bg) p-3";
export function KnowledgeManager({ initialDocs, samples, agents = [] }: { initialDocs: Document[]; samples: Document[]; agents?: { id: string; name: string }[] }) {
  const [docs, setDocs] = useState(initialDocs);
  const [title, setTitle] = useState(""), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Record<string, Revision[]>>({});
  function accept(doc: Document) { setDocs(previous => [doc, ...previous.filter(d => d.id !== doc.id)]); setMessage(`Saved ${doc.title} · v${doc.version ?? 1}. New runs use this version; publication requires current evaluation evidence.`); }
  async function paste(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, text }) });
      if (!response.ok) throw new Error(); accept((await response.json()).doc); setTitle(""); setText("");
    } catch { setMessage("Could not save the document. Check its length and try again."); } finally { setBusy(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const form = event.currentTarget, data = new FormData(form);
    const id = String(data.get("documentId") || "");
    if (id) data.set("expectedVersion", String(docs.find(d => d.id === id)?.version ?? 1)); else data.delete("documentId");
    try {
      const response = await fetch("/api/knowledge/upload", { method: "POST", body: data });
      if (!response.ok) throw new Error(); accept((await response.json()).doc); form.reset();
    } catch { setMessage("Upload rejected. Use UTF-8 .txt or .md up to 100 KB, select an agent for restricted access, and reload if replacing a changed version."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    try { const response = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" }); if (!response.ok) throw new Error(); setDocs(previous => previous.filter(doc => doc.id !== id)); setMessage("Document and stored versions deleted. Historical execution excerpts remain in their existing traces."); }
    catch { setMessage("Could not delete this document."); } finally { setBusy(false); }
  }
  async function history(id: string) {
    try { const r = await fetch(`/api/knowledge/${encodeURIComponent(id)}`); if (!r.ok) throw new Error(); const data = await r.json(); setRevisions(previous => ({ ...previous, [id]: data.revisions })); }
    catch { setMessage("Could not load source history."); }
  }
  return <section className="space-y-5"><h2 className="text-xl font-semibold">Grounded workspace knowledge</h2>
    <p className="text-sm text-(--ad-muted)">Upload policies as text or Markdown, retain versions, and limit access to selected agents. Search results carry source excerpts, version numbers and line citations. This is keyword retrieval; PDF, Word, OCR and embeddings are not enabled.</p>
    <p role="status" className="text-sm">{message}</p>
    <div className="grid gap-6 lg:grid-cols-2"><div className="space-y-5">
      <form onSubmit={upload} className="space-y-4 rounded-xl border border-(--ad-border) p-5"><h3 className="font-semibold">Upload a document</h3>
        <label className="block text-sm">File · UTF-8, up to 100 KB<input name="file" type="file" accept=".txt,.md,text/plain,text/markdown" required className={field} /></label>
        <label className="block text-sm">Title · optional<input name="title" maxLength={200} className={field} /></label>
        <label className="block text-sm">Save as<select name="documentId" className={field}><option value="">New document</option>{docs.map(d => <option key={d.id} value={d.id}>New version of {d.title} · v{d.version ?? 1}</option>)}</select></label>
        <label className="block text-sm">Access<select name="access" className={field}><option value="workspace">All agents in this workspace</option><option value="agents">Only selected agents below</option></select></label>
        <fieldset><legend className="text-sm">Agents for restricted access</legend>{agents.map(a => <label key={a.id} className="mt-2 flex gap-3 text-sm"><input type="checkbox" name="agentId" value={a.id} />{a.name}</label>)}</fieldset>
        <button disabled={busy} className="rounded-lg bg-(--ad-ice) px-4 py-2 text-(--ad-bg)">Upload and save version</button>
      </form>
      <form onSubmit={paste} className="space-y-4 rounded-xl border border-(--ad-border) p-5"><h3 className="font-semibold">Or paste workspace text</h3>
        <label className="block text-sm">Title<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} className={field} /></label>
        <label className="block text-sm">Document text<textarea value={text} onChange={e => setText(e.target.value)} required maxLength={8000} rows={6} className={field} /></label>
        <button disabled={busy} className="rounded-lg bg-(--ad-ice) px-4 py-2 text-(--ad-bg)">Save document</button>
      </form>
    </div><div className="space-y-3"><h3 className="font-semibold">Your documents · {docs.length}</h3>
      {docs.map(doc => <article key={doc.id} className="space-y-2 rounded-xl border border-(--ad-border) p-4"><h4>{doc.title} · v{doc.version ?? 1}</h4><p className="text-xs text-(--ad-muted)">{doc.sourceName ?? "Pasted text"} · {doc.access === "agents" ? `${doc.agentIds?.length ?? 0} selected agents` : "Workspace access"}</p>
        <details><summary className="cursor-pointer text-sm">Read document</summary><p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm text-(--ad-muted)">{doc.text}</p></details>
        <div className="flex gap-5"><button type="button" onClick={() => history(doc.id)} className="text-xs underline">Source history</button><button type="button" disabled={busy} onClick={() => remove(doc.id)} className="text-xs text-(--ad-error)">Delete document and versions</button></div>
        {revisions[doc.id]?.map(r => <p key={r.version} className="break-all text-xs text-(--ad-muted)">v{r.version} · {r.sourceName ?? "Pasted text"} · content hash {r.contentHash}</p>)}
      </article>)}
      {!docs.length && <p className="text-sm text-(--ad-muted)">No documents yet. Sample policies are used only while the workspace has no private documents.</p>}
      <details className="rounded-xl border border-(--ad-border) p-4"><summary className="cursor-pointer text-sm">Illustrative sample policies · {samples.length}</summary>{samples.map(d => <div key={d.id} className="mt-3"><h4 className="text-sm">{d.title}</h4><p className="text-xs text-(--ad-muted)">{d.text}</p></div>)}</details>
    </div></div>
  </section>;
}
