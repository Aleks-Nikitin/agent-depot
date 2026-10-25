"use client";

import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { TopNav } from "@/components/shell/top-nav";
import { AccountMenu } from "./account-menu";
import "@/components/ui/theme.css";

export function SiteNav() {
  const { data: session } = useSession();
  if (session) return <div className="ad"><TopNav /></div>;
  return <header className="border-b border-white/10 bg-zinc-950">
    <nav className="mx-auto flex h-16 w-full items-center justify-between px-6">
      <Link href="/" className="font-semibold tracking-tight">Agent Depot</Link>
      <AccountMenu />
    </nav>
  </header>;
}
