"use client";
import { useState, type FormEvent } from "react";

type Document = { id: string; title: string; text: string };
export function KnowledgeManager({ initialDocs, samples }: { initialDocs: Document[]; samples: Document[] }) {
  const [docs, setDocs] = useState(initialDocs);
  const [title, setTitle] = useState(""); const [text, setText] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, text }) });
      if (!response.ok) throw new Error("save_failed");
      const result = await response.json(); setDocs(previous => [result.doc, ...previous]); setTitle(""); setText(""); setMessage("Document saved. Knowledge Search can use it on the next run.");
    } catch { setMessage("Could not save the document. Check its length and try again."); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setMessage(null);
    try { const response = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" }); if (!response.ok) throw new Error(); setDocs(previous => previous.filter(doc => doc.id !== id)); setMessage("Document deleted. The next run uses the remaining workspace knowledge."); }
    catch { setMessage("Could not delete this document."); } finally { setBusy(false); }
  }
  return <div className="grid gap-6 lg:grid-cols-2">
    <form onSubmit={save} className="space-y-4 rounded-xl border border-(--ad-border) p-5">
      <h3 className="font-semibold">Add workspace knowledge</h3><p className="text-sm text-(--ad-muted)">Paste a policy or FAQ. Documents are private to your workspace and searchable by agents with Knowledge Search enabled.</p>
      <label className="block text-sm">Title<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} className="mt-2 w-full rounded-lg border border-(--ad-border) bg-(--ad-bg) p-3" /></label>
      <label className="block text-sm">Document text<textarea value={text} onChange={event => setText(event.target.value)} required maxLength={8000} rows={7} className="mt-2 w-full rounded-lg border border-(--ad-border) bg-(--ad-bg) p-3" /></label>
      <button type="submit" disabled={busy} className="rounded-lg bg-(--ad-ice) px-4 py-2 font-medium text-(--ad-bg) disabled:opacity-50">{busy ? "Saving…" : "Save document"}</button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
    <div className="space-y-3"><h3 className="font-semibold">Your documents · {docs.length}</h3>
      {docs.map(doc => <article key={doc.id} className="rounded-xl border border-(--ad-border) p-4"><div className="flex items-center justify-between gap-3"><h4>{doc.title}</h4><button type="button" disabled={busy} onClick={() => remove(doc.id)} className="text-xs text-(--ad-error)">Delete</button></div><p className="mt-2 whitespace-pre-wrap text-sm text-(--ad-muted)">{doc.text}</p></article>)}
      {!docs.length && <p className="text-sm text-(--ad-muted)">No workspace documents yet. The sample policies below remain available.</p>}
      <details className="rounded-xl border border-(--ad-border) p-4"><summary className="cursor-pointer text-sm">Included sample policies · {samples.length}</summary>{samples.map(doc => <div key={doc.id} className="mt-3"><h4 className="text-sm font-medium">{doc.title}</h4><p className="mt-1 text-xs text-(--ad-muted)">{doc.text}</p></div>)}</details>
    </div>
  </div>;
}
