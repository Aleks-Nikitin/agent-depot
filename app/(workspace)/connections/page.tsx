import { Suspense } from "react";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";
import { McpAccessPanel } from "@/components/mcp/access-panel";
import { listMcpKeys, mcpAudience } from "@/lib/mcp/keys";
import { mcpTools } from "@/lib/mcp/catalog";
import { getDb } from "@/lib/db/prisma";
async function Content() {
 const ownerId = await pageOwnerOrNull(); if (!ownerId) return <AuthPrompt />;
 const keys = await listMcpKeys(ownerId), agents = await getDb().agent.findMany({ where: { ownerId }, take: 100, select: { id: true, name: true } });
 return <McpAccessPanel initial={keys.map(k => ({ ...k, expiresAt: k.expiresAt.toISOString(), revokedAt: k.revokedAt?.toISOString() ?? null }))} endpoint={mcpAudience()} agents={agents} tools={mcpTools.map(t => ({ name: t.name, title: t.title, description: t.description }))} />;
}
export default function ConnectionsPage() { return <Suspense fallback={<p className="p-6">Loading MCP access…</p>}><Content /></Suspense>; }
