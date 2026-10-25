import type { ReactNode } from "react";
import "@/components/ui/theme.css";
import { fontVariables } from "@/components/ui/fonts";
import { cn } from "@/components/ui/cn";

/** Applies AgentDepot tokens, fonts and the background bloom to everything inside it. */
export function WorkspaceShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("ad ad-workspace flex min-h-screen flex-1 flex-col overflow-x-clip", fontVariables, className)}>
      <div className="ad-bloom" aria-hidden="true" />
      {children}
    </div>
  );
}
