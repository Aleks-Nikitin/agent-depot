import Link from "next/link";
import AgentBuilder from "../_components/AgentBuilder";
import { toolCatalog, agentTemplates } from "@/lib/agents/library/catalog";

export default function NewAgentPage() {
  return (
    <div className="space-y-6">
      <div className="mono flex items-center gap-2 text-[12px] text-muted">
        <Link href="/" className="hover:text-ink">
          agents
        </Link>
        <span>/</span>
        <span className="text-ink">new</span>
      </div>
      <div>
        <h1 className="font-serif text-[40px] leading-none">
          New <span className="italic">agent.</span>
        </h1>
        <p className="mt-3 text-[16px] italic text-muted">
          Draft with Gemini, pick a template, or configure from scratch.
        </p>
      </div>
      <AgentBuilder mode="create" catalog={toolCatalog} templates={agentTemplates} />
    </div>
  );
}
