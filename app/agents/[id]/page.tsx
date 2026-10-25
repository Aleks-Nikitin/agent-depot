import Link from "next/link";
import { notFound } from "next/navigation";
import AgentBuilder from "../_components/AgentBuilder";
import { toolCatalog, agentTemplates } from "@/lib/agents/library/catalog";
import { currentOwner } from "@/lib/agents/library/http";
import { getAgent } from "@/lib/agents/library/store";

// Loads an owner-scoped agent from the database per request; never prerendered.
export const instant = false;

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let agent;
  try {
    agent = await getAgent(currentOwner(), id);
  } catch {
    notFound();
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-zinc-400">
        <Link href="/" className="hover:text-white">
          Agents
        </Link>{" "}
        / {agent.name}
      </nav>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
        <span className="text-sm text-zinc-500">v{agent.version}</span>
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
