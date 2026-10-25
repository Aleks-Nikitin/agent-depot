import Link from "next/link";
import AgentBuilder from "../_components/AgentBuilder";
import { toolCatalog, agentTemplates } from "@/lib/agents/library/catalog";

export default function NewAgentPage() {
  return (
    <div>
      <nav className="mb-4 text-sm text-zinc-400">
        <Link href="/" className="hover:text-white">
          Agents
        </Link>{" "}
        / New
      </nav>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New agent</h1>
      <AgentBuilder mode="create" catalog={toolCatalog} templates={agentTemplates} />
    </div>
  );
}
