"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import AuthClientPage from "@/app/auth/auth-client";
import "@/components/ui/theme.css";

export function AuthRequired({ githubEnabled }: { githubEnabled: boolean }) {
  const [open, setOpen] = useState(true);
  return <section className="py-12 text-center">
    <h1 className="text-2xl font-semibold">Your agent workspace</h1>
    <p className="mt-3 text-zinc-400">Sign in, create an account, or continue as a guest to build and test agents.</p>
    <button type="button" onClick={() => setOpen(true)} className="mt-6 rounded-xl bg-sky-300 px-5 py-3 font-semibold text-zinc-950">Log in / Sign up</button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Log in / Sign up" className="max-h-[90vh] overflow-y-auto">
      <AuthClientPage githubEnabled={githubEnabled} callbackFailed={false} embedded />
    </Dialog>
  </section>;
}
