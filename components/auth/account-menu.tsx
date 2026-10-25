"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession, signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function AccountMenu() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  if (isPending) return <span className="px-3 text-xs text-zinc-400">Loading account…</span>;
  if (!session) return <Link href="/auth" className="px-3 py-1.5 text-sm text-sky-300">Sign in</Link>;
  async function logout() {
    setPending(true); setError(false);
    try {
      const result = await signOut();
      if (result.error) { setError(true); setPending(false); }
      else { router.replace("/"); router.refresh(); }
    } catch { setError(true); setPending(false); }
  }
  return <div className="flex items-center gap-2 text-sm">
    <span className="hidden max-w-40 truncate text-zinc-300 sm:inline">{session.user.isAnonymous ? "Guest workspace" : session.user.name}</span>
    <button type="button" onClick={logout} disabled={pending} className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-white/10 disabled:opacity-50">{pending ? "Signing out…" : "Sign out"}</button>
    {error && <span role="alert" className="text-xs text-red-300">Sign-out failed. Try again.</span>}
  </div>;
}
