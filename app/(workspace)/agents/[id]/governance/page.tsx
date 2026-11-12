import { Suspense } from "react";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";
import { AgentGovernancePanel } from "@/components/governance/agent-governance-panel";
import { governanceView } from "@/lib/governance/service";
import { getAgent } from "@/lib/agents/library/store";
async function Content({ params }: { params: Promise<{ id: string }> }) {
  const owner = await pageOwnerOrNull(); if (!owner) return <AuthPrompt />;
  const agent = await getAgent(owner, (await params).id);
  return <AgentGovernancePanel agentId={agent.id} initialVersion={agent.version} binding={agent.config.governance ?? null} library={await governanceView(owner)} />;
}
export default function GovernancePage({ params }: PageProps<"/agents/[id]/governance">) { return <Suspense fallback={<p className="p-6">Loading policies…</p>}><Content params={params} /></Suspense>; }
