import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Depot",
  description: "Create, configure, version, and publish enterprise AI agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <header className="border-b border-white/10 bg-black/40 backdrop-blur">
          <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 via-sky-400 to-amber-300 text-xs font-black text-black">
                AD
              </span>
              Agent Depot
            </Link>
            <div className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-white/10 hover:text-white"
              >
                Dashboard
              </Link>
              <Link
                href="/agents/new"
                className="rounded-md bg-white px-3 py-1.5 font-medium text-black hover:bg-zinc-200"
              >
                New Agent
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
