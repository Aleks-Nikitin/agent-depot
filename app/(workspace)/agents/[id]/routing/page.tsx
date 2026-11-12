import { Suspense } from "react";
import { notFound } from "next/navigation";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";
import { RoutingPanel } from "@/components/routing/routing-panel";
import { routingView } from "@/lib/routing/service";
async function Content({ params }: { params: Promise<{ id: string }> }) {
  const owner = await pageOwnerOrNull(); if (!owner) return <AuthPrompt />;
  let data;
  try { data = await routingView(owner, (await params).id); }
  catch (error) { if (error instanceof Error && error.message === "agent_not_found") notFound(); throw error; }
  return <RoutingPanel initial={data} />;
}
export default function RoutingPage({ params }: PageProps<"/agents/[id]/routing">) {
  return <Suspense fallback={<p className="p-6">Loading routing…</p>}><Content params={params} /></Suspense>;
}
