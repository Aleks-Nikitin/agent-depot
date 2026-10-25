import { io } from "next/cache";
import { Pill } from "@/components/ui/pill";
import { currentOwner } from "@/lib/agents/library/http";
import { getAgent } from "@/lib/agents/library/store";
import { formatCost } from "@/lib/runs/format";
import { getFixtureAgent, type AgentHeaderData } from "@/lib/fixtures/runs";
import { AgentTabs } from "./agent-tabs";

/** Server-only: the saved agent from Dev 1's store (current version, published state, limits); fixture ids fall back to fake data. */
export async function getAgentHeader(id: string): Promise<AgentHeaderData> {
  await io();
  try {
    const a = await getAgent(currentOwner(), id);
    return { id: a.id, name: a.name, version: a.version, publishedVersion: a.publishedVersion,
      status: a.published && a.publishedVersion === a.version ? "published" : "draft",
      model: process.env.RUNTIME_MODEL_ID || a.config.model, toolCount: a.config.enabledTools.length,
      costCapUsd: a.config.limits.maxEstimatedCostUsd, maxModelCalls: a.config.limits.maxModelCalls };
  } catch (error) {
    if (error instanceof Error && error.message === "agent_not_found") return getFixtureAgent(id);
    throw error;
  }
}

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
