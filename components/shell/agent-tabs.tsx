"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

// Builder lives at /agents/[id] (Dev 1); Playground and Tests are Dev 3 sub-routes.
// Shared navigation to persisted agent screens.
const tabs = [
  { segment: "builder", label: "Builder", path: "" },
  { segment: "playground", label: "Playground", path: "/playground" },
  { segment: "tests", label: "Tests", path: "/tests" },
  { segment: "versions", label: "Versions", path: "/versions" },
] as const;

export function AgentTabs({ agentId }: { agentId: string }) {
  const pathname = usePathname();
  const current = pathname.split("/")[3] ?? "builder";
  return (
    <nav aria-label="Agent sections" className="flex rounded-lg border border-(--ad-border) bg-(--ad-bg) p-1">
      {tabs.map(t => {
        const isActive = current === t.segment;
        return (
          <Link key={t.label} href={`/agents/${encodeURIComponent(agentId)}${t.path}`} aria-current={isActive ? "page" : undefined}
            className={cn("ad-mono rounded-md px-3 py-1.5 text-[13px] transition-colors",
              isActive ? "bg-(--ad-ice) text-(--ad-bg)" : "text-(--ad-muted) hover:text-(--ad-text)")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
