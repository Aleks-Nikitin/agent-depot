import { toolLabel } from "@/lib/agents/tool-labels";
import { Suspense } from "react";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { getDb } from "@/lib/db/prisma";
import { describeReason } from "@/lib/runs/format";
import { toolCatalog } from "@/lib/agents/library/catalog";
import { knowledgeDocs } from "@/lib/integrations/data/knowledge";
import { KnowledgeManager } from "@/components/shell/knowledge-manager";

async function Content() {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return <section className="space-y-6 p-6"><h1 className="text-3xl font-semibold">Explore the tools</h1><p>Browse freely. Sign in or continue as guest to save an agent, execute tools, or access workspace data.</p><div className="grid gap-4 md:grid-cols-2">{toolCatalog.map(tool => <article key={tool.id} className="rounded-xl border border-(--ad-border) p-5"><h2 className="font-semibold">{toolLabel(tool.id)}</h2><p className="mt-2 text-sm text-(--ad-muted)">{tool.description}</p>{tool.unavailableReason && <p className="mt-2 text-xs text-amber-300">{describeReason(tool.unavailableReason)}</p>}</article>)}</div></section>;
  const [docs, tickets] = await Promise.all([
    getDb().knowledgeDocument.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, text: true } }),
    getDb().demoTicket.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, subject: true, createdAt: true } }),
  ]);
  return <section className="space-y-8 p-6">
    <div><p className="text-xs uppercase tracking-widest text-(--ad-model)">Connect once. Reuse across agents.</p><h1 className="mt-3 text-3xl font-semibold">Tools & knowledge</h1><p className="mt-3 max-w-2xl text-(--ad-muted)">Enable these tools in each agent’s builder. Every call passes through the shared engine. Internal tickets create immediately; ownership and per-run limits still apply.</p></div>
    <p className="text-sm text-(--ad-muted)">SerpApi: {process.env.SERPAPI_API_KEY ? "API key configured; requests use live search or its cache." : "No key configured. Live shopping, news and webpage tools are unavailable until SERPAPI_API_KEY is configured."}</p>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{toolCatalog.map(tool => <article key={tool.id} className="rounded-xl border border-(--ad-border) bg-(--ad-surface) p-5"><h2 className="font-semibold">{toolLabel(tool.id)}</h2><p className="mt-2 text-sm text-(--ad-muted)">{tool.description}</p><p className="mt-4 text-xs text-(--ad-model)">{tool.id === "create_ticket" ? "Creates immediately · no approval required" : tool.kind === "write" ? "Write · saved review policy" : "Read · enabled per agent"}</p>{tool.unavailableReason && <p className="mt-2 text-xs text-amber-300">{describeReason(tool.unavailableReason)}</p>}</article>)}</div>
    <KnowledgeManager initialDocs={docs} samples={knowledgeDocs} />
    <section className="space-y-3"><h2 className="text-xl font-semibold">Support tickets</h2><p className="text-sm text-(--ad-muted)">Latest 10 recorded requests in this workspace. Creating a ticket does not process a refund or send a message.</p>{!tickets.length && <p>No support tickets yet.</p>}{tickets.map(ticket => <article key={ticket.id} className="rounded-xl border border-(--ad-border) p-4"><p>{ticket.subject}</p><p className="ad-mono mt-2 text-xs text-(--ad-muted)">{ticket.id} · {ticket.createdAt.toISOString()}</p></article>)}</section>
    <p className="text-sm text-(--ad-muted)">External messaging is not supported. Support tickets are internal records visible above.</p>
  </section>;
}
export default function Page() { return <Suspense fallback={<p className="p-6">Loading tools…</p>}><Content /></Suspense>; }
