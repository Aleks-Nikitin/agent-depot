import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { AlertIcon, BanIcon, ClockIcon } from "@/components/ui/icons";

export function UserBubble({ children, time }: { children: ReactNode; time?: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="max-w-[85%] rounded-xl border border-(--ad-border) bg-(--ad-raised) px-4 py-3 text-[15px] leading-relaxed">{children}</div>
      {time && <span className="ad-mono pr-1 text-xs text-(--ad-muted)">{time}</span>}
    </div>
  );
}

export function AgentBubble({ name, children, caption, onClick, selected }: {
  name: string; children: ReactNode; caption?: ReactNode; onClick?: () => void; selected?: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="ad-mono flex items-center gap-2 pl-1 text-[11px] tracking-wider text-(--ad-muted) uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-(--ad-model)" aria-hidden="true" />{name}
      </span>
      <div className={cn("max-w-[90%] rounded-xl border bg-(--ad-surface) px-4 py-3 text-[15px] leading-relaxed",
        selected ? "border-(--ad-muted)/50" : "border-(--ad-border)")}>{children}</div>
      {caption && (
        <button type="button" onClick={onClick} disabled={!onClick}
          className="ad-mono pl-1 text-xs text-(--ad-muted) enabled:hover:text-(--ad-text)">{caption}</button>
      )}
    </div>
  );
}

const noticeStyle = {
  approval: { box: "border-(--ad-approval-border) bg-(--ad-approval-bg)", text: "text-(--ad-approval)", icon: <ClockIcon size={18} /> },
  error: { box: "border-(--ad-error-border) bg-(--ad-error-bg)", text: "text-(--ad-error)", icon: <AlertIcon size={18} /> },
  blocked: { box: "border-(--ad-error-border) bg-(--ad-error-bg)", text: "text-(--ad-error)", icon: <BanIcon size={18} /> },
};

/** Paused / blocked / failed states in the conversation. Always an icon plus words, never colour alone. */
export function NoticeBubble({ kind, title, meta, children }: {
  kind: keyof typeof noticeStyle; title: string; meta?: string; children?: ReactNode;
}) {
  const s = noticeStyle[kind];
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4", s.box)} role="status">
      <span className={cn("mt-0.5 shrink-0", s.text)}>{s.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={cn("font-semibold", s.text)}>{title}</p>
          {meta && <span className={cn("ad-mono text-xs", s.text)}>{meta}</span>}
        </div>
        {children && <p className="mt-1 text-sm text-(--ad-text)/85">{children}</p>}
      </div>
    </div>
  );
}

export function TypingBubble({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5" aria-live="polite">
      <span className="ad-mono pl-1 text-[11px] tracking-wider text-(--ad-muted) uppercase">{name}</span>
      <div className="flex gap-1 rounded-xl border border-(--ad-border) bg-(--ad-surface) px-4 py-4" aria-label="Agent is working">
        {[0, 1, 2].map(i => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--ad-muted)" style={{ animationDelay: `${i * 150}ms` }} />)}
      </div>
    </div>
  );
}
