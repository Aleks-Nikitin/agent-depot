import { Suspense, type ReactNode } from "react";
import { TopNav } from "@/components/shell/top-nav";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

/** Dev 3 screens: AgentDepot theme, fonts, background bloom and the designed top nav. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShell>
      <Suspense fallback={<div className="h-16 border-b border-(--ad-border) bg-(--ad-surface)" />}>
        <TopNav />
      </Suspense>
      <div className="flex flex-1 flex-col">{children}</div>
    </WorkspaceShell>
  );
}
