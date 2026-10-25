import { Suspense } from "react";
import { listAgents } from "@/lib/agents/library/store";
import { listRuns } from "@/lib/runs/queries";
import Dashboard from "./dashboard";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";

async function SignedInDashboard() {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return <AuthPrompt />;
  const [agents, history] = await Promise.all([listAgents(ownerId), listRuns(ownerId)]);
  return <Dashboard initialAgents={agents} recentRuns={history.runs} />;
}

export default function Page() {
  return <Suspense fallback={<p>Loading your workspace…</p>}><SignedInDashboard /></Suspense>;
}
