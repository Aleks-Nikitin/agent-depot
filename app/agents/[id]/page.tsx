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
    <div className="space-y-6">
      <div className="mono flex items-center gap-2 text-[12px] text-muted">
        <Link href="/" className="hover:text-ink">
          agents
        </Link>
        <span>/</span>
        <span className="text-ink">{agent.id.slice(0, 8)}</span>
      </div>

      {/* Context header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-[32px] leading-none">{agent.name}</h1>
          <span className="mono rounded-[5px] border border-line bg-panel px-2 py-0.5 text-[12px] text-muted">
            v{agent.version}
          </span>
          {agent.published ? (
            <span className="mono rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-[11px] text-success">
              published v{agent.publishedVersion}
            </span>
          ) : (
            <span className="mono rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] text-accent">
              draft
            </span>
          )}
        </div>
        <span className="mono text-[12px] text-muted">
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
