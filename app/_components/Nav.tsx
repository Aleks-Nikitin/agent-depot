"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Agents" },
  { href: "/agents/new", label: "New Agent" },
];

export default function Nav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/agents/") && pathname !== "/agents/new" : pathname === href;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-panel">
      <nav className="mx-auto flex h-[52px] w-full max-w-[1400px] items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-[4px] bg-primary font-mono text-[10px] font-bold text-primary-text">
            AD
          </span>
          <span className="text-[13px] font-semibold text-text">Agent Depot</span>
        </Link>

        <div className="flex h-full items-center gap-1">
          {links.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex h-full items-center px-3 text-[13px] transition-colors ${
                  active ? "text-text" : "text-muted hover:text-text"
                }`}
              >
                {link.label}
                {active && (
                  <span className="absolute inset-x-2 bottom-0 h-px bg-text/70" />
                )}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 rounded-[6px] border border-border bg-surface px-2.5 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className="font-mono text-[11px] text-muted">demo</span>
        </div>
      </nav>
    </header>
  );
}
