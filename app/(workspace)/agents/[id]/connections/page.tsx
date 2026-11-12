import { Suspense } from "react";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";
import { AgentGitHubPanel } from "@/components/connectors/agent-github-panel";
import { agentGitHubView } from "@/lib/connectors/bindings";
async function Content({ params }: { params: Promise<{ id: string }> }) {
  const owner = await pageOwnerOrNull(); if (!owner) return <AuthPrompt />;
  return <AgentGitHubPanel initial={await agentGitHubView(owner, (await params).id)} />;
}
export default function ConnectionsPage({ params }: PageProps<"/agents/[id]/connections">) {
  return <Suspense fallback={<p className="p-6">Loading connections…</p>}><Content params={params} /></Suspense>;
}
