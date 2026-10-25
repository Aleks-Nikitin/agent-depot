import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import { describeReason } from "@/lib/runs/format";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { Pill } from "@/components/ui/pill";
import { pageOwner } from "@/lib/auth/session";
import { getAgent } from "@/lib/agents/library/store";
import { formatCost } from "@/lib/runs/format";
import { type AgentHeaderData } from "@/lib/fixtures/runs";
import { AgentTabs } from "./agent-tabs";

/** Server-only owner-scoped metadata; unknown agents render the normal 404 boundary. */
export async function getAgentHeader(id: string): Promise<AgentHeaderData> {
  await io();
  let a;
  try { a = await getAgent(await pageOwner(), id); }
  catch (error) { if (error instanceof Error && error.message === "agent_not_found") notFound(); throw error; }
  const selected = a.config.enabledTools.map(id => runtimeRegistry.get(id));
  const toolWarnings = [...new Set(selected.flatMap(tool => tool?.retired ? [describeReason("email_removed")] : tool?.unavailable?.() ? [describeReason(tool.unavailable()!)] : []))];
  return { toolWarnings, id: a.id, name: a.name, version: a.version, publishedVersion: a.publishedVersion,
    status: a.published && a.publishedVersion === a.version ? "published" : "draft",
    model: process.env.RUNTIME_MODEL_ID || a.config.model, toolCount: selected.filter(tool => tool && !tool.retired && !tool.unavailable?.()).length,
    costCapUsd: a.config.limits.maxEstimatedCostUsd, maxModelCalls: a.config.limits.maxModelCalls };
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
