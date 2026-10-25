import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { AlertIcon, LockIcon } from "@/components/ui/icons";
import { toneText, type Tone } from "@/components/ui/pill";
import { describeModelStep, type ApprovalItem, type Trace, type TraceItem } from "@/lib/playground/reduce-events";
import { ApprovalCard } from "./approval-card";
import { ModelStepCard, OutcomeRow, ToolStepCard } from "./step-card";

type Row = { key: string; tone: Tone; icon?: ReactNode; node: ReactNode };

function Dot({ tone, icon }: { tone: Tone; icon?: ReactNode }) {
  return (
    <span className={cn("relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 border-current bg-(--ad-bg)", toneText[tone])}>
      {icon ?? <span className="h-2 w-2 rounded-full bg-current" />}
    </span>
  );
}

/**
 * The step timeline, shared by the live playground and the read-only run detail.
 * A write that needed approval is shown once, as its approval card, followed by the tool result if it ran.
 */
export function TracePanel({ trace, model, collapsed, now, onDecide, busy, emptyState }: {
  trace: Trace; model: string; collapsed?: boolean; now?: number;
  onDecide?: (approvalId: string, approved: boolean) => void; busy?: boolean; emptyState?: ReactNode;
}) {
  const approvalsByCall = new Map(trace.items.filter((i): i is ApprovalItem => i.kind === "approval").map(a => [a.toolCallId, a]));
  const rows: Row[] = [];
  let step = 0;
  const pushTool = (item: Extract<TraceItem, { kind: "tool" }>) => {
    step++;
    rows.push({ key: item.id, tone: item.status === "failed" ? "error" : "tool", icon: item.status === "failed" ? <AlertIcon size={13} /> : undefined,
      node: <ToolStepCard item={item} step={step} collapsed={collapsed} /> });
  };

  trace.items.forEach((item, index) => {
    if (item.kind === "model") {
      step++;
      rows.push({ key: item.id, tone: "model", node: <ModelStepCard item={item} step={step} model={model} collapsed={collapsed}
        description={describeModelStep(trace.items, index)} /> });
    } else if (item.kind === "tool") {
      if (!approvalsByCall.has(item.id)) pushTool(item);
    } else if (item.kind === "approval") {
      step++;
      rows.push({ key: item.id, tone: "approval", icon: <LockIcon size={13} />,
        node: <ApprovalCard item={item} now={now} busy={busy} onDecide={onDecide ? approved => onDecide(item.id, approved) : undefined} /> });
      const tool = trace.items.find(i => i.kind === "tool" && i.id === item.toolCallId);
      if (tool?.kind === "tool" && ["running", "succeeded", "failed"].includes(tool.status)) pushTool(tool);
    }
  });
  const outcome = trace.items.find(i => i.kind === "outcome");

  if (!rows.length && !outcome) return <>{emptyState}</>;
  return (
    <div>
      <ol className="relative">
        {rows.map((r, i) => (
          <li key={r.key} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-4 sm:gap-4">
            <div className="relative flex justify-center pt-3">
              {(i < rows.length - 1 || outcome) && <span className="absolute top-10 -bottom-3 w-px bg-(--ad-border)" aria-hidden="true" />}
              <Dot tone={r.tone} icon={r.icon} />
            </div>
            {r.node}
          </li>
        ))}
      </ol>
      {outcome?.kind === "outcome" && <OutcomeRow item={outcome} status={trace.status} durationMs={trace.totals.durationMs} />}
      {trace.status === "running" && busy && (
        <p className="ad-mono pl-11 text-xs text-(--ad-muted)">Running…</p>
      )}
    </div>
  );
}
