import type { ComponentProps, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export const fieldClass = "w-full rounded-lg border border-(--ad-border) bg-(--ad-raised) px-3 text-sm text-(--ad-text) placeholder:text-(--ad-muted)/70 focus:border-(--ad-muted)/60 focus:outline-none disabled:opacity-60";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-24 resize-y py-2.5", className)} {...props} />;
}

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("ad-mono mb-2 block text-[11px] font-medium tracking-wider text-(--ad-muted) uppercase", className)}>
      {children}
    </label>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button type="button" role="switch" id={id} aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full border transition-colors",
        checked ? "border-transparent bg-(--ad-ice)" : "border-(--ad-border) bg-(--ad-raised)")}>
      <span className={cn("absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all",
        checked ? "left-[22px] bg-(--ad-bg)" : "left-1 bg-(--ad-muted)")} />
    </button>
  );
}
