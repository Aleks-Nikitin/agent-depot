import { Suspense } from "react";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";
import { TeamsPanel } from "@/components/governance/teams-panel";
import { governanceView } from "@/lib/governance/service";
async function Content() {
  const owner = await pageOwnerOrNull(); if (!owner) return <AuthPrompt />;
  return <TeamsPanel initial={await governanceView(owner)} />;
}
export default function TeamsPage() { return <Suspense fallback={<p className="p-6">Loading teams…</p>}><Content /></Suspense>; }
