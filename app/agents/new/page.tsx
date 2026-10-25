import Link from "next/link";
import AgentBuilder from "../_components/AgentBuilder";
import { toolCatalog, agentTemplates, templateByKey } from "@/lib/agents/library/catalog";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";

export default async function NewAgentPage({ searchParams }: PageProps<"/agents/new">) {
  if (!await pageOwnerOrNull()) return <AuthPrompt />;
  const query = await searchParams;
  const template = typeof query.template === "string" ? templateByKey(query.template) : undefined;
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <nav className="mb-4 text-sm text-zinc-400">
        <Link href="/" className="hover:text-white">
          Agents
        </Link>{" "}
        / New
      </nav>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New agent</h1>
      <AgentBuilder mode="create" catalog={toolCatalog} templates={agentTemplates} initialTemplate={template} />
    </div>
  );
}
