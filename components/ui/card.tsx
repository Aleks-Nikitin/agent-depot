import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-(--ad-border) bg-(--ad-surface)", className)} {...props} />;
}

export function CardHeader({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-14 flex-wrap items-center gap-3 border-b border-(--ad-border) px-5 py-3", className)}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}

/** Raised inner box, e.g. INPUT / OUTPUT panes or the email preview. */
export function Inset({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-(--ad-border) bg-(--ad-raised) p-3", className)}>
      {label && <div className="mb-1.5 text-[11px] font-medium tracking-wider text-(--ad-muted) uppercase">{label}</div>}
      {children}
    </div>
  );
}

export function StatCard({ label, value, caption, valueClassName }: {
  label: string; value: ReactNode; caption?: ReactNode; valueClassName?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-[13px] text-(--ad-muted)">{label}</div>
      <div className={cn("ad-mono mt-1.5 text-2xl font-semibold", valueClassName)}>{value}</div>
      {caption && <div className="mt-1 text-xs text-(--ad-muted)">{caption}</div>}
    </Card>
  );
}
