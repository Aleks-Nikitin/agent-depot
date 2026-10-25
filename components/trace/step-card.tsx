import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { AlertIcon, BanIcon, CheckIcon } from "@/components/ui/icons";
import { toneBorder, toneSurface, toneText, type Tone } from "@/components/ui/pill";
import type { ModelItem, OutcomeItem, ToolItem } from "@/lib/playground/reduce-events";
import { describeReason, formatCost, formatDuration, formatTokens, type RunStatus } from "@/lib/runs/format";
import { IoBox } from "./io-box";

function StepLabel({ tone, step, kind, name }: { tone: Tone; step: number; kind: string; name?: string }) {
  return (
    <span className={cn("ad-mono inline-flex h-7 shrink-0 items-center rounded-md border px-2.5 text-xs", toneSurface[tone], toneText[tone])}>
      Step {step} · {kind}{name ? ` · ${name}` : ""}
    </span>
  );
}

function Shell({ tone, children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-(--ad-surface) p-4", tone ? toneBorder[tone] : "border-(--ad-border)", className)}>
      {children}
    </div>
  );
}

const Meta = ({ children }: { children: ReactNode }) => (
  <span className="ad-mono ml-auto shrink-0 text-xs text-(--ad-muted)">{children}</span>
);

export function ModelStepCard({ item, step, model, description, collapsed }: {
  item: ModelItem; step: number; model: string; description: string; collapsed?: boolean;
}) {
  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StepLabel tone="model" step={step} kind="Model" name={model} />
        <Meta>
          {item.status === "running" ? "running…"
            : `${formatTokens(item.tokens)} · ${formatCost(item.usage?.estimatedCostUsd)} · ${formatDuration(item.durationMs)}`}
        </Meta>
      </div>
      {!collapsed && <p className="mt-3 text-sm text-(--ad-text)/90">{description}</p>}
    </Shell>
  );
}

export function ToolStepCard({ item, step, collapsed }: { item: ToolItem; step: number; collapsed?: boolean }) {
  if (item.status === "failed") {
    return (
      <Shell tone="error" className="bg-(--ad-error-bg)/40">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StepLabel tone="error" step={step} kind="Error" />
          <span className="ad-mono text-sm text-(--ad-error)">{item.toolId}</span>
          <Meta>{formatDuration(item.durationMs)}</Meta>
        </div>
        {!collapsed && (
          <div className="mt-3 flex gap-2.5 rounded-lg border border-(--ad-error-border) bg-(--ad-bg)/60 p-3 text-(--ad-error)">
            <AlertIcon className="mt-0.5 shrink-0" />
            <p className="ad-mono text-xs leading-relaxed">{describeReason(item.reason ?? "tool_failed")}</p>
          </div>
        )}
      </Shell>
    );
  }
  const running = item.status === "running" || item.status === "requested";
  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StepLabel tone="tool" step={step} kind="Tool" />
        <span className="ad-mono text-sm">{item.toolId}</span>
        <Meta>{running ? "running…" : formatDuration(item.durationMs)}</Meta>
        {item.authorization === "policy" && <span className="text-xs text-(--ad-model)">Automatic · saved policy</span>}
      </div>
      {!collapsed && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <IoBox label="Input" value={item.input} />
          <IoBox label="Output" value={running ? "Waiting for result…" : item.output} />
        </div>
      )}
    </Shell>
  );
}

const outcomeStyle: Record<"completed" | "rejected" | "blocked" | "failed", { tone: Tone; title: string; icon: ReactNode }> = {
  completed: { tone: "success", title: "Finished · succeeded", icon: <CheckIcon /> },
  rejected: { tone: "approval", title: "Finished · write rejected", icon: <CheckIcon /> },
  blocked: { tone: "error", title: "Blocked", icon: <BanIcon /> },
  failed: { tone: "error", title: "Failed", icon: <AlertIcon /> },
};

/** Final row. Blocked and failed runs show the reason and never a fabricated answer. */
export function OutcomeRow({ item, status, durationMs }: { item: OutcomeItem; status: RunStatus | null; durationMs: number | null }) {
  const key = item.status === "completed" && status === "rejected" ? "rejected" : item.status;
  const s = outcomeStyle[key];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3", toneSurface[s.tone], toneText[s.tone])}>
      {s.icon}
      <span className="ad-mono text-sm">
        {s.title}{item.reason ? ` · ${describeReason(item.reason)}` : ""}
      </span>
      <span className="ad-mono ml-auto text-xs">Duration: {formatDuration(durationMs)}</span>
    </div>
  );
}
