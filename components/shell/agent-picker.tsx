import Link from "next/link";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { listAgents } from "@/lib/agents/library/store";

export async function AgentPicker({ section }: { section: "playground" | "tests" }) {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return null;
  const agents = await listAgents(ownerId);
  return <section className="space-y-5 p-6">
    <h1 className="text-2xl font-semibold">{section === "tests" ? "Evaluation Lab" : "Playground"}</h1>
    <p className="text-(--ad-muted)">Choose an agent from your workspace.</p>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{agents.map(agent => <Link key={agent.id} href={`/agents/${agent.id}/${section}`} className="rounded-xl border border-(--ad-border) bg-(--ad-surface) p-5 hover:border-(--ad-model)">
      <h2 className="font-semibold">{agent.name}</h2><p className="mt-2 text-sm text-(--ad-muted)">v{agent.version} · {agent.enabledTools.length} tools</p>
    </Link>)}</div>
    {!agents.length && <p>No agents yet. <Link href="/agents/new" className="text-(--ad-model) underline">Create your first agent</Link>.</p>}
  </section>;
}
