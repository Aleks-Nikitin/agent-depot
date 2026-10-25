import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaygroundScreen } from "@/components/playground/chat-panel";
import { getFixtureAgent } from "@/lib/fixtures/runs";

export const metadata: Metadata = { title: "Playground · AgentDepot" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaygroundScreen agent={getFixtureAgent(decodeURIComponent(id))} />;
}

export default function PlaygroundPage({ params }: PageProps<"/agents/[id]/playground">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-(--ad-muted)">Loading playground…</p>}>
      <Content params={params} />
    </Suspense>
  );
}
