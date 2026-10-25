import { Suspense } from "react";
import { listAgents } from "@/lib/agents/library/store";
import { listRuns } from "@/lib/runs/queries";
import Dashboard from "./dashboard";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthLanding } from "@/components/auth/auth-landing";

async function SignedInDashboard() {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) {
    const githubEnabled = !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET;
    return <AuthLanding githubEnabled={githubEnabled} />;
  }
  const [agents, history] = await Promise.all([listAgents(ownerId), listRuns(ownerId)]);
  return <Dashboard initialAgents={agents} recentRuns={history.runs} />;
}

export default function Page() {
  return <Suspense fallback={<p>Loading your workspace…</p>}><SignedInDashboard /></Suspense>;
}
