import Link from "next/link";
import AgentBuilder from "../_components/AgentBuilder";
import { toolCatalog, agentTemplates, templateByKey } from "@/lib/agents/library/catalog";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { getDb } from "@/lib/db/prisma";

export default async function NewAgentPage({ searchParams }: PageProps<"/agents/new">) {
  const owner = await pageOwnerOrNull();
  const user = owner ? await getDb().user.findUnique({ where: { id: owner }, select: { name: true, isAnonymous: true } }) : null;
  const workspaceName = !user || user.isAnonymous ? "Guest" : user.name;
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
      <AgentBuilder mode="create" catalog={toolCatalog} templates={agentTemplates} initialTemplate={template} workspaceName={workspaceName} githubEnabled={!!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET} />
    </div>
  );
}
