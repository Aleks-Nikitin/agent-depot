"use client";

import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { TopNav } from "@/components/shell/top-nav";
import { AccountMenu } from "./account-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import "@/components/ui/theme.css";

export function SiteNav() {
  const { data: session } = useSession();
  if (session) return <div className="ad"><TopNav /></div>;
  return <header className="border-b border-(--page-border) bg-(--page-bg) text-(--page-fg)">
    <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6">
      <Link href="/" className="font-semibold tracking-tight">Agent Depot</Link>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <AccountMenu />
      </div>
    </nav>
  </header>;
}
