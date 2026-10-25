import { ButtonLink } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";

export function Promotion() { return (
<section className="relative isolate overflow-hidden rounded-3xl border border-sky-300/20 bg-[radial-gradient(ellipse_at_85%_25%,#25455f_0%,#101d30_40%,#0c1220_75%)] px-6 py-10 sm:px-10 lg:py-14">
            <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-96 w-96 rounded-full border border-sky-200/10 shadow-[0_0_110px_35px_#55c6ea10]" />
            <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
              <div>
                <p className="ad-mono text-[11px] uppercase tracking-[0.24em] text-sky-200">AgentDepot / powered by Gemini</p>
                <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.12] tracking-tight text-white sm:text-5xl">From an idea.<br /><span className="text-sky-200">To an agent you can inspect.</span></h1>
                <p className="mt-5 max-w-lg text-sm leading-7 text-slate-300">Give it a goal. Choose its tools. Test every revision, control sensitive actions, and follow every execution in one workspace.</p>
                <div className="mt-7 flex flex-wrap gap-3"><ButtonLink href="/agents/new" variant="primary"><PlusIcon size={14} /> Build an agent</ButtonLink><ButtonLink href="/tools" variant="secondary">Explore tools →</ButtonLink></div>
                <p className="mt-5 text-xs text-slate-400">Reusable configurations · Guarded automation · Saved execution traces</p>
              </div>
              <div aria-label="Agent workflow" className="relative space-y-3 lg:pl-5">
                {([
                  ["01", "Define the job", "Instructions + permitted tools", "Draft a spec with Gemini"],
                  ["02", "Prove the behavior", "Saved checks + execution evidence", "Test before publishing"],
                  ["03", "Stay in control", "Enforce write policies + inspect history", "Every step leaves a trace"],
                ] as const).map(([number, title, description, caption]) => <div key={number} className="flex items-center gap-4 rounded-xl border border-sky-200/15 bg-slate-950/45 px-5 py-4 shadow-xl backdrop-blur-sm">
                  <span className="ad-mono text-xs text-sky-300/70">{number}</span><div><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs text-slate-400">{description}</p></div><span className="ml-auto hidden max-w-28 text-right text-[10px] text-sky-200/70 sm:block">{caption}</span>
                </div>)}
              </div>
            </div>
          </section>
); }
