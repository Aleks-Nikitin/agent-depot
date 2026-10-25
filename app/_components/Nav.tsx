"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const links = [
  { href: "/", label: "Agents" },
  { href: "/agents/new", label: "New Agent" },
];

export default function Nav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/" ||
        (pathname.startsWith("/agents/") && pathname !== "/agents/new")
      : pathname === href;

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur">
      <nav className="mx-auto flex h-[56px] w-full max-w-[1200px] items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-ink mono text-[10px] font-bold text-paper">
            AD
          </span>
          <span className="label-mono !text-ink !tracking-[0.18em]">
            Agent Depot
          </span>
        </Link>

        <div className="flex items-center gap-6">
          {links.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`label-mono !tracking-[0.16em] transition-colors ${
                  active
                    ? "!text-ink border-b border-accent pb-0.5"
                    : "hover:!text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <span className="mono text-[11px] text-muted">demo</span>
          </div>
        </div>
      </nav>
    </header>
  );
}
