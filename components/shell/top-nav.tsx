"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Backlit } from "@/components/ui/backlit";
import { cn } from "@/components/ui/cn";
import { DEFAULT_AGENT_ID } from "@/lib/fixtures/runs";

// PLACEHOLDER(P1): Dev 1 owns the root layout nav. This is the designed nav, mounted on Dev 3 screens.
export function TopNav({ workspace = "AcmeStore" }: { workspace?: string }) {
  const pathname = usePathname();
  // Playground / Tests follow the agent you are looking at, else the default demo agent.
  const agentId = pathname.match(/^\/agents\/([^/]+)/)?.[1] ?? DEFAULT_AGENT_ID;
  const links = [
    { href: "/", label: "Agents", active: pathname === "/" || (/^\/agents/.test(pathname) && !/\/(playground|tests)$/.test(pathname)) },
    { href: "/runs", label: "Runs", active: pathname.startsWith("/runs") },
    { href: `/agents/${agentId}/playground`, label: "Playground", active: pathname.endsWith("/playground") },
    { href: `/agents/${agentId}/tests`, label: "Tests", active: pathname.endsWith("/tests") },
  ];
  return (
    <header className="border-b border-(--ad-border) bg-(--ad-surface)">
      <nav className="flex h-16 items-center gap-4 overflow-x-auto px-4 sm:gap-8 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-[17px] font-semibold tracking-tight">
          <Backlit edge="corner" className="rounded-md">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-(--ad-border) bg-(--ad-bg) text-xs font-bold">A</span>
          </Backlit>
          <span className="hidden sm:inline">AgentDepot</span>
        </Link>
        <div className="flex h-full items-stretch gap-1 text-sm">
          {links.map(l => (
            <Link key={l.label} href={l.href} aria-current={l.active ? "page" : undefined}
              className={cn("flex items-center border-b-2 px-2.5 text-(--ad-muted) transition-colors hover:text-(--ad-text)",
                l.active ? "border-(--ad-ice) text-(--ad-text)" : "border-transparent")}>
              {l.label}
            </Link>
          ))}
        </div>
        <span className="ml-auto hidden shrink-0 items-center gap-2 rounded-lg border border-(--ad-border) bg-(--ad-raised) px-3 py-1.5 text-[13px] sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-(--ad-model)" aria-hidden="true" />
          {workspace}
        </span>
      </nav>
    </header>
  );
}
