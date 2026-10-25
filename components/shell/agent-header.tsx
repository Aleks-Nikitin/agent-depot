import { Pill } from "@/components/ui/pill";
import { formatCost } from "@/lib/runs/format";
import type { AgentHeaderData } from "@/lib/fixtures/runs";
import { AgentTabs } from "./agent-tabs";

export function AgentHeader({ agent }: { agent: AgentHeaderData }) {
  const testing = agent.status === "draft" && agent.publishedVersion != null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-(--ad-border) bg-(--ad-surface)/60 px-4 py-3.5 sm:px-6">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="ad-mono truncate text-lg font-semibold">{agent.name}</h1>
        <Pill tone={agent.status === "published" ? "success" : "neutral"} className="ad-mono">
          v{agent.version} · {agent.status}
        </Pill>
        <p className="ad-mono text-[13px] text-(--ad-muted)">
          {testing
            ? <>Published: v{agent.publishedVersion} · Testing: v{agent.version}</>
            : <>{agent.model} · {agent.toolCount} tools · cost cap {formatCost(agent.costCapUsd)} · max {agent.maxModelCalls} steps</>}
        </p>
      </div>
      <AgentTabs agentId={agent.id} />
    </div>
  );
}

export function AgentHeaderSkeleton() {
  return <div className="h-[61px] border-b border-(--ad-border) bg-(--ad-surface)/60" aria-hidden="true" />;
}
