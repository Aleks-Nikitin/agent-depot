import { Suspense, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

function WorkspaceContent({ children }: { children: ReactNode }) {
  return <WorkspaceShell>
    <div className="flex flex-1 flex-col">{children}</div>
  </WorkspaceShell>;
}

/** Shared appearance. Private pages enforce sessions; the tools catalog is public. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="p-6">Loading your workspace…</p>}>
      <WorkspaceContent>{children}</WorkspaceContent>
    </Suspense>
  );
}
