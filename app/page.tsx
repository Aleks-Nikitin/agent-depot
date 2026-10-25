import { Suspense } from "react";
import Dashboard from "./dashboard";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";

async function SignedInDashboard() {
  if (!await pageOwnerOrNull()) return <AuthPrompt />;
  return <Dashboard />;
}

export default function Page() {
  return <Suspense fallback={<p>Loading your workspace…</p>}><SignedInDashboard /></Suspense>;
}
