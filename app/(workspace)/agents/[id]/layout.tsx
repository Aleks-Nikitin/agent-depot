import { Suspense } from "react";
import { AgentHeader, AgentHeaderSkeleton } from "@/components/shell/agent-header";
import { getFixtureAgent } from "@/lib/fixtures/runs";

async function Header({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentHeader agent={getFixtureAgent(decodeURIComponent(id))} />;
}

export default function AgentLayout({ children, params }: LayoutProps<"/agents/[id]">) {
  return (
    <>
      <Suspense fallback={<AgentHeaderSkeleton />}>
        <Header params={params} />
      </Suspense>
      {children}
    </>
  );
}
