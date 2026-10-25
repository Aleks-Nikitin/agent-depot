import type { ReactNode } from "react";
import type { RunStatus } from "@/lib/runs/format";
import { cn } from "./cn";
import { AlertIcon, BanIcon, CheckIcon, ClockIcon, PlayIcon, XIcon } from "./icons";

// Status palette from the design spec. Tones are always paired with an icon and a word.
export type Tone = "model" | "tool" | "approval" | "error" | "success" | "neutral";

export const toneText: Record<Tone, string> = {
  model: "text-(--ad-model)", tool: "text-(--ad-tool)", approval: "text-(--ad-approval)",
  error: "text-(--ad-error)", success: "text-(--ad-success)", neutral: "text-(--ad-muted)",
};
export const toneSurface: Record<Tone, string> = {
  model: "bg-(--ad-model-bg) border-(--ad-model-border)",
  tool: "bg-(--ad-tool-bg) border-(--ad-tool-border)",
  approval: "bg-(--ad-approval-bg) border-(--ad-approval-border)",
  error: "bg-(--ad-error-bg) border-(--ad-error-border)",
  success: "bg-(--ad-success-bg) border-(--ad-success-border)",
  neutral: "bg-(--ad-raised) border-(--ad-border)",
};
export const toneBorder: Record<Tone, string> = {
  model: "border-(--ad-model-border)", tool: "border-(--ad-tool-border)", approval: "border-(--ad-approval-border)",
  error: "border-(--ad-error-border)", success: "border-(--ad-success-border)", neutral: "border-(--ad-border)",
};
export const toneDot: Record<Tone, string> = {
  model: "bg-(--ad-model)", tool: "bg-(--ad-tool)", approval: "bg-(--ad-approval)",
  error: "bg-(--ad-error)", success: "bg-(--ad-success)", neutral: "bg-(--ad-muted)",
};

export function Pill({ tone = "neutral", icon, children, className }: {
  tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
      toneSurface[tone], toneText[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export const statusStyle: Record<RunStatus, { tone: Tone; label: string; icon: ReactNode }> = {
  running: { tone: "model", label: "running", icon: <PlayIcon size={12} /> },
  waiting_approval: { tone: "approval", label: "paused", icon: <ClockIcon size={12} /> },
  completed: { tone: "success", label: "succeeded", icon: <CheckIcon size={12} /> },
  rejected: { tone: "approval", label: "rejected", icon: <XIcon size={12} /> },
  blocked: { tone: "error", label: "blocked", icon: <BanIcon size={12} /> },
  failed: { tone: "error", label: "failed", icon: <AlertIcon size={12} /> },
  interrupted: { tone: "error", label: "interrupted", icon: <AlertIcon size={12} /> },
};

export function StatusPill({ status, className }: { status: RunStatus; className?: string }) {
  const s = statusStyle[status];
  return <Pill tone={s.tone} icon={s.icon} className={cn("ad-mono", className)}>{s.label}</Pill>;
}

/** Small neutral mono tag, e.g. a version "v2". */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("ad-mono inline-flex h-6 items-center rounded-md border border-(--ad-border) bg-(--ad-raised) px-2 text-xs text-(--ad-muted)", className)}>
      {children}
    </span>
  );
}

/** Square mono chip for checks and tool names, optionally removable. */
export function Chip({ tone = "neutral", dot, onRemove, children, className }: {
  tone?: Tone; dot?: boolean; onRemove?: () => void; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn("ad-mono inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-xs",
      toneSurface[tone], tone === "neutral" ? "text-(--ad-text)/85" : toneText[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", toneDot[tone])} aria-hidden="true" />}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove" className="-mr-1 grid h-5 w-5 place-items-center rounded hover:bg-white/10">
          <XIcon size={12} />
        </button>
      )}
    </span>
  );
}
