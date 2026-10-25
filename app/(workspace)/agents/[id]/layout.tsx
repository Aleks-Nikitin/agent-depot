import { Suspense } from "react";
import { AgentHeader, AgentHeaderSkeleton, getAgentHeader } from "@/components/shell/agent-header";

async function Header({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentHeader agent={await getAgentHeader(decodeURIComponent(id))} />;
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
