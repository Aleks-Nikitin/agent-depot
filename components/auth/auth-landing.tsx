"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";
import AuthClientPage from "@/app/auth/auth-client";
import "@/components/ui/theme.css";

const steps = [
  ["01", "Define the job", "Instructions + permitted tools", "Draft a spec with Gemini"],
  ["02", "Prove the behavior", "Saved checks + execution evidence", "Test before publishing"],
  ["03", "Stay in control", "Approve writes + inspect history", "Every step leaves a trace"],
] as const;

export function AuthLanding({ githubEnabled }: { githubEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [guestPending, setGuestPending] = useState(false);

  async function continueAsGuest() {
    if (guestPending) return;
    setGuestPending(true);
    try {
      const result = await signIn.anonymous();
      if (result.error) {
        setGuestPending(false);
        setOpen(true);
      } else {
        router.replace("/");
        router.refresh();
      }
    } catch {
      setGuestPending(false);
      setOpen(true);
    }
  }

  return (
    <div className="ad min-h-screen">
      <div className="ad-bloom" aria-hidden="true" />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-16">
        <section className="relative isolate overflow-hidden rounded-3xl border border-(--ad-border) bg-[radial-gradient(ellipse_at_85%_25%,#f4efe3_0%,#ece9e0_45%,#e3dccb_78%)] px-6 py-12 sm:px-10 lg:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-28 h-96 w-96 rounded-full border border-[#b2552f1a] shadow-[0_0_110px_35px_#b2552f10]"
          />
          <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="ad-mono text-[11px] uppercase tracking-[0.24em] text-[#b2552f]">
                AgentDepot / powered by Gemini
              </p>
              <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.12] tracking-tight text-(--ad-text) sm:text-5xl">
                From an idea.
                <br />
                <span className="text-[#b2552f]">To an agent you can inspect.</span>
              </h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-(--ad-muted)">
                Give it a goal. Choose its tools. Test every revision, approve sensitive
                actions, and follow every execution in one workspace.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button variant="primary" onClick={() => setOpen(true)}>
                  Sign in / Sign up
                </Button>
                <Button variant="secondary" onClick={continueAsGuest} disabled={guestPending}>
                  {guestPending ? "Starting…" : "Continue as guest →"}
                </Button>
              </div>
              <p className="mt-5 text-xs text-(--ad-muted)">
                Reusable configurations · Human approvals · Saved execution traces
              </p>
            </div>
            <div aria-label="Agent workflow" className="relative space-y-3 lg:pl-5">
              {steps.map(([number, title, description, caption]) => (
                <div
                  key={number}
                  className="flex items-center gap-4 rounded-xl border border-(--ad-border) bg-(--ad-surface) px-5 py-4 shadow-sm"
                >
                  <span className="ad-mono text-xs text-(--ad-model)">{number}</span>
                  <div>
                    <h2 className="text-sm font-semibold text-(--ad-text)">{title}</h2>
                    <p className="mt-1 text-xs text-(--ad-muted)">{description}</p>
                  </div>
                  <span className="ml-auto hidden max-w-28 text-right text-[10px] text-(--ad-muted) sm:block">
                    {caption}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Log in / Sign up"
        className="max-h-[90vh] overflow-y-auto"
      >
        <AuthClientPage githubEnabled={githubEnabled} callbackFailed={false} embedded />
      </Dialog>
    </div>
  );
}
