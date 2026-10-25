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
  if (!ownerId) return null;
  const { id } = await params;
  const query = await searchParams;
  const runId = typeof query.runId === "string" ? query.runId : undefined;
  const saved = runId ? await getRun(ownerId, runId) : null;
  if (runId && (!saved || saved.run.agentId !== id)) notFound();
  const agent = await getAgentHeader(id).catch(error => { if (error instanceof Error && error.message === "agent_not_found") notFound(); throw error; });
  return <PlaygroundScreen agent={agent} initialRunId={runId} initialMessage={saved?.run.input} />;
}

export default function PlaygroundPage({ params, searchParams }: PageProps<"/agents/[id]/playground">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-(--ad-muted)">Loading playground…</p>}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}
