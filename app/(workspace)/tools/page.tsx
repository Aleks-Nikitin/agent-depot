import { Suspense } from "react";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { getDb } from "@/lib/db/prisma";
import { toolCatalog } from "@/lib/agents/library/catalog";
import { knowledgeDocs } from "@/lib/integrations/data/knowledge";
import { KnowledgeManager } from "@/components/shell/knowledge-manager";

async function Content() {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return <section className="space-y-6 p-6"><h1 className="text-3xl font-semibold">Explore the tools</h1><p>Browse freely. Sign in or continue as guest to save an agent, execute tools, or access workspace data.</p><div className="grid gap-4 md:grid-cols-2">{toolCatalog.map(tool => <article key={tool.id} className="rounded-xl border border-(--ad-border) p-5"><h2 className="font-semibold">{tool.id}</h2><p className="mt-2 text-sm text-(--ad-muted)">{tool.description}</p></article>)}</div></section>;
  const [docs, emails, tickets] = await Promise.all([
    getDb().knowledgeDocument.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, text: true } }),
    getDb().recordedEmail.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, to: true, subject: true, createdAt: true } }),
    getDb().demoTicket.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, subject: true, createdAt: true } }),
  ]);
  return <section className="space-y-8 p-6">
    <div><p className="text-xs uppercase tracking-widest text-(--ad-model)">Connect once. Reuse across agents.</p><h1 className="mt-3 text-3xl font-semibold">Tools & knowledge</h1><p className="mt-3 max-w-2xl text-(--ad-muted)">Enable these tools in each agent’s builder. Every call passes through the shared engine; writes follow the saved approval/automatic policy and server restrictions.</p></div>
    <p className="text-sm text-(--ad-muted)">SerpApi: {process.env.SERPAPI_API_KEY ? "API key configured; requests use live search or its cache." : "No key configured. Only clearly labeled sample queries are available; other searches fail visibly."}</p>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{toolCatalog.map(tool => <article key={tool.id} className="rounded-xl border border-(--ad-border) bg-(--ad-surface) p-5"><h2 className="font-semibold">{tool.id}</h2><p className="mt-2 text-sm text-(--ad-muted)">{tool.description}</p><p className="mt-4 text-xs text-(--ad-model)">{tool.requiresApproval ? "Write · saved policy + server restrictions" : "Read · enabled per agent"}</p></article>)}</div>
    <KnowledgeManager initialDocs={docs} samples={knowledgeDocs} />
    <section className="space-y-3"><h2 className="text-xl font-semibold">Support tickets</h2><p className="text-sm text-(--ad-muted)">Latest 10 recorded requests in this workspace. Creating a ticket does not process a refund or send a message.</p>{!tickets.length && <p>No support tickets yet.</p>}{tickets.map(ticket => <article key={ticket.id} className="rounded-xl border border-(--ad-border) p-4"><p>{ticket.subject}</p><p className="ad-mono mt-2 text-xs text-(--ad-muted)">{ticket.id} · {ticket.createdAt.toISOString()}</p></article>)}</section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Recorded emails</h2><p className="text-sm text-(--ad-muted)">Email is a record-only demonstration. No external email provider is connected and nothing is delivered.</p>
      {!emails.length && <p className="text-sm text-(--ad-muted)">No recorded emails yet.</p>}
      {emails.map(email => <article key={email.id} className="rounded-xl border border-(--ad-border) p-4"><p>{email.subject}</p><p className="mt-1 text-xs text-(--ad-muted)">{email.to} · {email.createdAt.toISOString()}</p></article>)}
    </section>
  </section>;
}
export default function Page() { return <Suspense fallback={<p className="p-6">Loading tools…</p>}><Content /></Suspense>; }
