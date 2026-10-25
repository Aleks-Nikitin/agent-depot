import Link from "next/link";
import { notFound } from "next/navigation";
import AgentBuilder from "../_components/AgentBuilder";
import { toolCatalog, agentTemplates } from "@/lib/agents/library/catalog";
import { currentOwner } from "@/lib/agents/library/http";
import { getAgent, type AgentDetail } from "@/lib/agents/library/store";

// Loads an owner-scoped agent from the database per request; never prerendered.
export const instant = false;

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let agent: AgentDetail;
  try {
    agent = await getAgent(currentOwner(), id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
        <Link href="/" className="hover:text-text">
          agents
        </Link>
        <span>/</span>
        <span className="text-text">{agent.id.slice(0, 8)}</span>
      </div>

      {/* Context header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-border bg-panel px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-bold text-text">{agent.name}</span>
          <span className="rounded-[4px] border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">
            v{agent.version}
          </span>
          {agent.published ? (
            <span className="rounded-full bg-success/12 px-2 py-0.5 font-mono text-[10px] text-success">
              published v{agent.publishedVersion}
            </span>
          ) : (
            <span className="rounded-full bg-pending/12 px-2 py-0.5 font-mono text-[10px] text-pending">
              draft
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-muted">
          {agent.versions.length} version{agent.versions.length === 1 ? "" : "s"}
        </span>
      </div>

      <AgentBuilder
        mode="edit"
        catalog={toolCatalog}
        templates={agentTemplates}
        initial={agent}
      />
    </div>
  );
}
