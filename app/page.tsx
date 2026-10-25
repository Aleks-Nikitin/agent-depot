import { Suspense } from "react";
import { listAgents } from "@/lib/agents/library/store";
import { listRuns } from "@/lib/runs/queries";
import Dashboard from "./dashboard";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { Promotion } from "@/components/marketing/promotion";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

async function SignedInDashboard() {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return <WorkspaceShell><main className="mx-auto w-full max-w-7xl space-y-8 p-6"><Promotion /><p className="text-sm text-(--ad-muted)">Explore the builder freely. Sign in or continue as guest when you save, draft with Gemini, or execute an agent.</p></main></WorkspaceShell>;
  const [agents, history] = await Promise.all([listAgents(ownerId), listRuns(ownerId)]);
  return <Dashboard initialAgents={agents} recentRuns={history.runs} />;
}

export default function Page() {
  return <Suspense fallback={<p>Loading your workspace…</p>}><SignedInDashboard /></Suspense>;
}
