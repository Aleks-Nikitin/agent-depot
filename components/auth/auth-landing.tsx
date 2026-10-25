"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";
import AuthClientPage from "@/app/auth/auth-client";
import "@/components/ui/theme.css";

const steps = [
  ["01", "Define the job", "Instructions + permitted tools", "Draft a spec with Gemini"],
  ["02", "Prove the behavior", "Saved checks + execution evidence", "Test before publishing"],
  ["03", "Stay in control", "Bound actions + inspect history", "Every step leaves a trace"],
] as const;

const features = [
  ["Draft with Gemini", "Describe a goal in plain language; Gemini proposes instructions, tools, and tests."],
  ["Guarded actions", "Internal tickets create immediately within write limits. Inspect their inputs and outcomes in the trace."],
  ["Versioned configs", "Every save is a new version. Roll back instantly and publish only what passed its checks."],
  ["Full observability", "Every run leaves a trace: model steps, tool calls, cost, and outcome — all inspectable."],
] as const;

const templates = [
  ["customer-support", "Support template", "Answers grounded in your policies", "Knowledge search, internal support tickets, and three saved checks."],
  ["competitor-pricing-analyst", "Pricing template", "Turn sales figures into decisions", "Prepared sales data, competitor lookup, and three saved checks."],
] as const;

export function AuthLanding({ githubEnabled }: { githubEnabled: boolean }) {
  const router = useRouter();
  const callbackFailed = useSearchParams().get("authError") === "1";
  const [open, setOpen] = useState(callbackFailed);
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
    <div className="ad min-h-screen w-full overflow-x-hidden">
      <div className="ad-bloom" aria-hidden="true" />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-16">
        <section className="relative isolate overflow-hidden rounded-3xl border border-(--ad-border) bg-[var(--ad-hero)] px-6 py-12 sm:px-10 lg:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-28 h-96 w-96 rounded-full border border-(--ad-border) shadow-[0_0_110px_35px_rgba(0,0,0,0.04)]"
          />
          <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="ad-mono text-[11px] uppercase tracking-[0.24em] text-[var(--ad-hero-accent)]">
                AgentDepot / powered by Gemini
              </p>
              <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.12] tracking-tight text-(--ad-text) sm:text-5xl">
                From an idea.
                <br />
                <span className="text-[var(--ad-hero-accent)]">To an agent you can inspect.</span>
              </h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-(--ad-muted)">
                Give it a goal. Choose its tools. Test every revision, bound tool
                actions, and follow every execution in one workspace.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/agents/new" className="rounded-lg bg-(--ad-text) px-4 py-2 text-sm font-medium text-(--ad-bg)">Build an agent</Link>
                <Link href="/tools" className="rounded-lg border border-(--ad-border) px-4 py-2 text-sm font-medium">Explore tools →</Link>
                <Button variant="primary" onClick={() => setOpen(true)}>
                  Sign in / Sign up
                </Button>
                <Button variant="secondary" onClick={continueAsGuest} disabled={guestPending}>
                  {guestPending ? "Starting…" : "Continue as guest →"}
                </Button>
              </div>
              <p className="mt-5 text-xs text-(--ad-muted)">
                Reusable configurations · Guarded automation · Saved execution traces
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

        {/* What you can do */}
        <section className="mt-10" aria-label="Capabilities">
          <p className="ad-mono text-[11px] uppercase tracking-[0.2em] text-(--ad-muted)">
            What you can do
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(([title, body]) => (
              <div key={title} className="rounded-xl border border-(--ad-border) bg-(--ad-surface) p-5">
                <h3 className="text-sm font-semibold text-(--ad-text)">{title}</h3>
                <p className="mt-2 text-xs leading-6 text-(--ad-muted)">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Starter templates */}
        <section className="mt-10" aria-label="Starter templates">
          <p className="ad-mono text-[11px] uppercase tracking-[0.2em] text-(--ad-muted)">
            Start from a template
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {templates.map(([key, tag, title, body]) => (
              <Link
                key={key}
                href={`/agents/new?template=${key}`}
                className="rounded-xl border border-(--ad-border) p-5 text-left transition-colors hover:bg-(--ad-raised)"
              >
                <p className="ad-mono text-[10px] uppercase tracking-widest text-(--ad-model)">{tag}</p>
                <h3 className="mt-2 font-semibold text-(--ad-text)">{title}</h3>
                <p className="mt-2 text-sm text-(--ad-muted)">{body} Explore template →</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mt-10 mb-4 rounded-2xl border border-(--ad-border) bg-(--ad-surface) px-6 py-8 text-center">
          <h2 className="text-xl font-semibold text-(--ad-text)">Build your first agent in minutes.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-(--ad-muted)">
            Create a free workspace, or try everything instantly as a guest.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button variant="primary" onClick={() => setOpen(true)}>
              Sign in / Sign up
            </Button>
            <Button variant="secondary" onClick={continueAsGuest} disabled={guestPending}>
              {guestPending ? "Starting…" : "Continue as guest →"}
            </Button>
          </div>
        </section>
      </main>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Log in / Sign up"
        className="max-h-[90vh] overflow-y-auto"
      >
        <AuthClientPage githubEnabled={githubEnabled} callbackFailed={callbackFailed} embedded />
      </Dialog>
    </div>
  );
}
