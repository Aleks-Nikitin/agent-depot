"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Backlit } from "@/components/ui/backlit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, downloadFile } from "@/components/ui/cn";
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from "@/components/ui/icons";
import { StatusPill } from "@/components/ui/pill";
import { TracePanel } from "@/components/trace/trace-panel";
import { TraceTotals } from "@/components/trace/trace-totals";
import type { AgentHeaderData } from "@/lib/fixtures/runs";
import type { Trace, TraceItem } from "@/lib/playground/reduce-events";
import { CLIENT_MODE, useRun } from "@/lib/playground/use-run";
import { describeReason, formatClock, formatCost, formatDuration, runLabel } from "@/lib/runs/format";
import { AgentBubble, NoticeBubble, TypingBubble, UserBubble } from "./chat-bubble";
import { MessageComposer } from "./message-composer";

type Turn = { key: string; message: string; trace: Trace };

const toolPhrase: Record<string, string> = { create_ticket: "create a ticket" };

/** Position of the approval in the visible timeline, matching the step numbers in the trace. */
function approvalStep(items: TraceItem[]): number {
  const gated = new Set(items.filter(i => i.kind === "approval").map(i => i.kind === "approval" ? i.toolCallId : ""));
  let n = 0;
  for (const i of items) {
    if (i.kind === "model" || (i.kind === "tool" && !gated.has(i.id))) n++;
    if (i.kind === "approval") return n + 1;
  }
  return n;
}

function TurnReply({ trace, agentName, busy, error, interrupted, selected, onSelect }: {
  trace: Trace; agentName: string; busy?: boolean; error?: string | null; interrupted?: boolean; selected?: boolean; onSelect?: () => void;
}) {
  if (error) return <NoticeBubble kind="error" title="Could not run the agent">{describeReason(error)}</NoticeBubble>;
  if (interrupted) return <NoticeBubble kind="error" title="Connection ended">{describeReason("stream_ended")}. Check Runs for the saved result.</NoticeBubble>;
  const caption = <>Run {runLabel(trace.runId)} · {formatDuration(trace.totals.durationMs)} · {formatCost(trace.totals.costUsd)}</>;
  const completedTickets = trace.items.filter(item => item.kind === "tool" && item.toolId === "create_ticket" && item.status === "succeeded");
  const actionSummary = completedTickets.length ? <span className="mt-2 block">{completedTickets.length} support ticket(s) already created. <Link href="/tools" className="underline">View tickets</Link> before retrying to avoid creating duplicates.</span> : null;
  switch (trace.status) {
    case "completed":
    case "rejected":
      return <AgentBubble name={agentName} caption={caption} onClick={onSelect} selected={selected}>{trace.response}{completedTickets.length > 0 && <p className="mt-3 text-sm"><Link href="/tools" className="underline">View created support tickets</Link></p>}</AgentBubble>;
    case "waiting_approval": {
      const a = trace.pendingApproval!;
      return (
        <NoticeBubble kind="approval" title={`Waiting for approval to ${toolPhrase[a.toolId] ?? `run ${a.toolId}`}`} meta={`Trace step #${approvalStep(trace.items)}`}>
          The saved policy or this tool’s restrictions require review for this action. Check the exact arguments in the trace.
        </NoticeBubble>
      );
    }
    case "blocked":
      return <NoticeBubble kind="blocked" title={`Stopped: ${describeReason(trace.stopReason ?? "blocked")}`}>No answer was produced. Check the explanation above before changing the request.{actionSummary}</NoticeBubble>;
    case "failed":
      return <NoticeBubble kind="error" title="Couldn’t finish this request">{describeReason(trace.stopReason ?? "execution_failed")}.{actionSummary}</NoticeBubble>;
    default:
      return busy ? <TypingBubble name={agentName} /> : null;
  }
}

/**
 * Playground screen: owns the conversation and the live run, renders chat on the left and the trace on the right.
 * Each message starts a new run on the same agent; earlier turns keep their final trace so you can reopen it.
 */
export function PlaygroundScreen({ agent, initialRunId, initialMessage }: { agent: AgentHeaderData; initialRunId?: string; initialMessage?: string }) {
  const run = useRun();
  const [history, setHistory] = useState<Turn[]>([]);
  const [current, setCurrent] = useState<string | null>(initialMessage ?? null);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const viewing = viewKey ? history.find(t => t.key === viewKey) ?? null : null;
  const shown = viewing?.trace ?? run.trace;
  const replay = run.replay;
  useEffect(() => { if (initialRunId) void replay(initialRunId); }, [initialRunId, replay]);
  useEffect(() => {
    if (run.trace.runId) window.history.replaceState(null, "", `/agents/${encodeURIComponent(agent.id)}/playground?runId=${encodeURIComponent(run.trace.runId)}`);
  }, [agent.id, run.trace.runId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [history.length, current, run.trace.status]);

  const send = (message: string) => {
    if (current && run.trace.runId) setHistory(h => [...h, { key: run.trace.runId!, message: current, trace: run.trace }]);
    setCurrent(message);
    setViewKey(null);
    void run.start(agent.id, message);
  };
  const newRun = () => { run.reset(); setHistory([]); setCurrent(null); setViewKey(null); window.history.replaceState(null, "", `/agents/${encodeURIComponent(agent.id)}/playground`); };

  return (
    <div className="grid flex-1 gap-5 p-4 sm:p-6 lg:h-[calc(100dvh-125px)] lg:min-h-155 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-[minmax(0,1fr)]">
      <Card className="flex min-h-130 flex-col overflow-hidden lg:min-h-0">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-(--ad-border) px-5">
          <span className="h-2 w-2 rounded-full bg-(--ad-success)" aria-hidden="true" />
          <h2 className="text-[15px] font-semibold">Chat</h2>
          <span className="ad-mono text-xs text-(--ad-muted)">· {agent.name}</span>
          <Button size="sm" className="ad-mono ml-auto" onClick={newRun} disabled={run.busy}><RefreshIcon size={14} /> New run</Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {agent.toolWarnings?.map(warning => <div key={warning} role="note" className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-200">{warning}. <Link href={`/agents/${agent.id}`} className="underline">Review tools</Link></div>)}
          {!history.length && !current && (
            <p className="py-10 text-center text-sm text-(--ad-muted)">Ask {agent.name} something. Each message is one run, traced step by step.</p>
          )}
          {history.map(t => (
            <div key={t.key} className="space-y-5">
              <UserBubble time={t.trace.events[0] && formatClock(t.trace.events[0].timestamp)}>{t.message}</UserBubble>
              <TurnReply trace={t.trace} agentName={agent.name} selected={viewKey === t.key}
                onSelect={() => setViewKey(viewKey === t.key ? null : t.key)} />
            </div>
          ))}
          {current && (
            <div className="space-y-5">
              <UserBubble time={run.trace.events[0] && formatClock(run.trace.events[0].timestamp)}>{current}</UserBubble>
              <TurnReply trace={run.trace} agentName={agent.name} busy={run.busy} error={run.error} interrupted={run.interrupted}
                selected={!viewKey} onSelect={() => setViewKey(null)} />
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="shrink-0 border-t border-(--ad-border) p-4">
          <MessageComposer onSend={send} disabled={run.busy} />
        </div>
      </Card>

      <Backlit edge="top-right" live={run.busy} className="flex min-h-130 lg:min-h-0">
        <Card className="flex w-full flex-col overflow-hidden">
          <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--ad-border) px-5 py-3">
            <h2 className="text-[15px] font-semibold">Trace{shown.runId && <> · Run {runLabel(shown.runId)}</>}</h2>
            {shown.status && <StatusPill status={shown.status} />}
            {viewing && <span className="ad-mono text-xs text-(--ad-muted)">earlier turn</span>}
            {shown.runId && <TraceTotals totals={shown.totals} />}
            {shown.runId && <Link href={`/runs/${encodeURIComponent(shown.runId)}`} className="text-xs text-(--ad-model) hover:underline">Saved run</Link>}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" className="ad-mono" onClick={() => setCollapsed(c => !c)} aria-pressed={collapsed}>
                {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />} {collapsed ? "Expand" : "Collapse"}
              </Button>
              <Button size="sm" variant="secondary" className="ad-mono" disabled={run.busy || !current} onClick={() => current && send(current)}>
                <RefreshIcon size={14} /> Re-run
              </Button>
              <Button size="sm" variant="secondary" className="ad-mono" disabled={!shown.events.length}
                onClick={() => downloadFile(`trace-${shown.runId}.json`, JSON.stringify(shown.events, null, 2))}>
                Export
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <TracePanel trace={shown} model={agent.model} collapsed={collapsed} busy={run.busy && !viewing}
              onDecide={viewing ? undefined : (id, approved) => void run.decide(id, approved)}
              emptyState={<p className="py-16 text-center text-sm text-(--ad-muted)">Send a message to start a run. Every model step and tool call appears here as it happens.</p>} />
          </div>
          <div className="ad-mono flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--ad-border) px-5 py-3 text-xs text-(--ad-muted)">
            <span>Guardrails: saved write policy enforced · cost cap {formatCost(agent.costCapUsd)} · max {agent.maxModelCalls} steps</span>
            {CLIENT_MODE === "mock" && <span className={cn("ml-auto rounded border border-(--ad-border) px-1.5 py-0.5")}>Simulated runtime · fixture data</span>}
          </div>
        </Card>
      </Backlit>
    </div>
  );
}
