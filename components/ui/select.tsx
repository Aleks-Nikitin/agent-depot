import type { SelectHTMLAttributes } from "react";
import { cn } from "./cn";
import { ChevronDownIcon } from "./icons";
import { fieldClass } from "./input";

/** Native select styled like the other fields; an optional inline prefix reads like "Agent: All agents". */
export function Select({ className, prefix, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { prefix?: string }) {
  return (
    <div className={cn("relative", className)}>
      {prefix && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-(--ad-muted)">{prefix}</span>}
      <select className={cn(fieldClass, "ad-mono h-10 cursor-pointer appearance-none pr-9 text-[13px]")} style={prefix ? { paddingLeft: `${prefix.length * 7 + 20}px` } : undefined} {...props}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-(--ad-muted)" />
    </div>
  );
}
