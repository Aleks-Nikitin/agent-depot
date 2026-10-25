"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Backlit } from "@/components/ui/backlit";
import { cn } from "@/components/ui/cn";
import { AccountMenu } from "@/components/auth/account-menu";

// Shared navigation for the signed-in workspace.
export function TopNav({ workspace = "Personal workspace" }: { workspace?: string }) {
  const pathname = usePathname();
  // Playground / Tests follow the selected agent, otherwise open the agent chooser.
  const candidate = pathname.match(/^\/agents\/([^/]+)/)?.[1];
  const agentId = candidate !== "new" ? candidate : undefined;
  const links = [
    { href: "/", label: "Agents", active: pathname === "/" || (/^\/agents/.test(pathname) && !/\/(playground|tests)$/.test(pathname)) },
    { href: "/runs", label: "Runs", active: pathname.startsWith("/runs") },
    { href: agentId ? `/agents/${agentId}/playground` : "/playground", label: "Playground", active: pathname.endsWith("/playground") },
    { href: agentId ? `/agents/${agentId}/tests` : "/tests", label: "Tests", active: pathname.endsWith("/tests") },
    { href: "/tools", label: "Tools & knowledge", active: pathname === "/tools" },
  ];
  return (
    <header className="border-b border-(--ad-border) bg-(--ad-surface)">
      <nav className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 px-4 sm:px-6 lg:flex-nowrap lg:gap-5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-[17px] font-semibold tracking-tight">
          <Backlit edge="corner" className="rounded-md">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-(--ad-border) bg-(--ad-bg) text-xs font-bold">A</span>
          </Backlit>
          <span className="hidden sm:inline">AgentDepot</span>
        </Link>
        <div className="order-last flex h-12 w-full items-stretch gap-1 overflow-x-auto whitespace-nowrap text-sm lg:order-none lg:h-16 lg:w-auto">
          {links.map(l => (
            <Link key={l.label} href={l.href} aria-current={l.active ? "page" : undefined}
              className={cn("flex items-center border-b-2 px-2.5 text-(--ad-muted) transition-colors hover:text-(--ad-text)",
                l.active ? "border-(--ad-ice) text-(--ad-text)" : "border-transparent")}>
              {l.label}
            </Link>
          ))}
        </div>
        <span className="ml-auto hidden shrink-0 items-center gap-2 rounded-lg border border-(--ad-border) bg-(--ad-raised) px-3 py-1.5 text-[13px] xl:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-(--ad-model)" aria-hidden="true" />
          {workspace}
        </span>
        <AccountMenu />
      </nav>
    </header>
  );
}
