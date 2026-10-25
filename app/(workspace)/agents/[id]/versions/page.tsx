import { Suspense } from "react";
import { notFound } from "next/navigation";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { getAgent } from "@/lib/agents/library/store";
import { getDb } from "@/lib/db/prisma";
import { VersionsPanel } from "@/components/shell/versions-panel";
import { toYaml } from "@/lib/agents/library/yaml";

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const ownerId = await pageOwnerOrNull(); if (!ownerId) return null;
  const { id } = await params;
  const agent = await getAgent(ownerId, id).catch(() => null); if (!agent) notFound();
  const rows = await getDb().agentVersion.findMany({ where: { agentId: id, agent: { ownerId } }, orderBy: { version: "desc" } });
  return <VersionsPanel agentId={id} currentVersion={agent.version} versions={rows.map(row => ({ version: row.version, name: row.name,
    createdAt: row.createdAt.toISOString(), published: agent.publishedVersion === row.version, spec: toYaml(row.config) }))} />;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="p-6">Loading versions…</p>}><Content params={params} /></Suspense>;
}
