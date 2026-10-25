import Link from "next/link";
import AgentBuilder from "../_components/AgentBuilder";
import { toolCatalog, agentTemplates } from "@/lib/agents/library/catalog";

export default function NewAgentPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
        <Link href="/" className="hover:text-text">
          agents
        </Link>
        <span>/</span>
        <span className="text-text">new</span>
      </div>
      <div>
        <h1 className="text-[18px] font-semibold text-text">New agent</h1>
        <p className="mt-0.5 text-[12px] text-muted">
          Draft with Gemini, pick a template, or configure from scratch.
        </p>
      </div>
      <AgentBuilder mode="create" catalog={toolCatalog} templates={agentTemplates} />
    </div>
  );
}
