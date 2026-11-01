import { conversationView } from "@/lib/agents/sessions/store";
import { resolveDraft } from "@/lib/agents/releases/resolve";
import { getDb } from "@/lib/db/prisma";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { deriveTrace } from "@/lib/playground/reduce-events";
import { AuthPrompt } from "@/components/auth/auth-prompt";
import { pageOwnerOrNull } from "@/lib/auth/session";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaygroundScreen } from "@/components/playground/chat-panel";
import { getAgentHeader } from "@/components/shell/agent-header";
import { getRun } from "@/lib/runs/queries";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Playground · AgentDepot" };

async function Content({ params, searchParams }: PageProps<"/agents/[id]/playground">) {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return <AuthPrompt />;
  const { id } = await params;
  const query = await searchParams;
  const runId = typeof query.runId === "string" ? query.runId : undefined;
  const saved = runId ? await getRun(ownerId, runId) : null;
  if (runId && (!saved || saved.run.agentId !== id)) notFound();
  const agent = await getAgentHeader(id).catch(error => { if (error instanceof Error && error.message === "agent_not_found") notFound(); throw error; });
  const sessionId = typeof query.sessionId === "string" ? query.sessionId : undefined;
  const session = sessionId ? await conversationView(ownerId, id, sessionId).catch(() => null) : null;
  if (sessionId && !session) notFound();
  const target = session?.target ?? (query.target === "release" ? "release" : "draft");
  const selectedVersion = session?.version ?? (typeof query.draftVersion === "string" ? Number(query.draftVersion) : agent.version);
  if (!Number.isSafeInteger(selectedVersion) || selectedVersion < 1) notFound();
  if (target === "draft") await resolveDraft(ownerId, id, selectedVersion).catch(() => notFound());
  const drafts = await getDb().agentDraft.findMany({ where: { agentId: id }, select: { version: true }, orderBy: { version: "desc" } });
  const turns = await Promise.all((session?.turns ?? []).map(async turn => ({ key: turn.id, message: turn.input ?? "",
    trace: deriveTrace((await new PrismaRunStore(getDb()).history(turn.id, ownerId)).events) })));
  const current = turns.at(-1);
  return <PlaygroundScreen key={session?.id ?? `${target}:${selectedVersion}`} agent={agent} initialRunId={current?.key ?? runId}
    initialMessage={current?.message ?? saved?.run.input} initialSession={session ? { id: session.id, version: session.version, target: session.target } : undefined}
    initialTurns={turns.slice(0, -1)} draftVersions={drafts.map(draft => draft.version)} selectedVersion={selectedVersion} target={target} />;
}

export default function PlaygroundPage({ params, searchParams }: PageProps<"/agents/[id]/playground">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-(--ad-muted)">Loading playground…</p>}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}
