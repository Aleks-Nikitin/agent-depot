import { Suspense, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";

async function ProtectedWorkspace({ children }: { children: ReactNode }) {
  if (!await pageOwnerOrNull()) return <AuthPrompt />;
  return <WorkspaceShell>
    <div className="flex flex-1 flex-col">{children}</div>
  </WorkspaceShell>;
}

/** Dev 3 screens: AgentDepot theme, fonts, background bloom and the designed top nav. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="p-6">Loading your workspace…</p>}>
      <ProtectedWorkspace>{children}</ProtectedWorkspace>
    </Suspense>
  );
}
