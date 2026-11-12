"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import { StateDiff } from "@/components/tests/state-diff";
import { OUTCOME_LABELS, evaluationOutcome } from "@/lib/evals/outcome";
import type { benchmarkView } from "@/lib/routing/report";
const usd = (v: number | null) => v === null ? "Unknown" : `$${v.toFixed(6)}`;
const ms = (v: number | null) => v === null ? "Unknown" : `${v} ms`;
export function BenchmarkPanel({ initial }: { initial: Awaited<ReturnType<typeof benchmarkView>> }) {
  const [data, setData] = useState(initial); const [error, setError] = useState("");
  const terminal = ["completed", "failed", "cancelled"].includes(data.status);
  useEffect(() => {
    if (terminal) return;
    let active = true; let pending = false;
    const tick = async () => {
      if (pending) return; pending = true;
      try { const r = await fetch(`/api/benchmarks/${data.id}${data.comparison ? `?compareTo=${encodeURIComponent(data.comparison.id)}` : ""}`, { cache: "no-store" }); if (!r.ok) throw new Error(); const next = await r.json(); if (active) { setData(next); setError(""); } }
      catch { if (active) setError("Reconnecting to the recorded comparison…"); } finally { pending = false; }
    };
    const timer = setInterval(() => { void tick(); }, 1500); return () => { active = false; clearInterval(timer); };
  }, [data.id, data.comparison, terminal]);
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `comparison-${data.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="space-y-6 p-4 sm:p-6">
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-semibold">Model comparison · v{data.version}</h1><p className="mt-2 text-sm" role="status">{data.status} · {data.repeats} repeat(s) per arm · {data.cases.length} identical cases</p></div><div className="flex gap-2"><Button onClick={download}>Export report</Button><ButtonLink href={`/agents/${data.agentId}/routing`}>Routing settings</ButtonLink></div></header>
    <p className="text-sm text-(--ad-muted)">{data.notice} Missing trials remain in the denominator. A cheaper result with worse behavior is visible as a tradeoff.</p>
    <div className="grid gap-4 lg:grid-cols-2">{data.arms.map(arm => <section key={arm.arm} className="space-y-3 rounded-xl border border-(--ad-border) bg-(--ad-surface) p-5">
      <h2 className="font-semibold">{arm.arm === "primary" ? "Primary only (locked)" : "Saved routing policy"}</h2>
      <dl className="ad-mono space-y-2 text-sm">{[
        ["Behavior passed", `${arm.passed} / ${arm.expected}`], ["State correct", `${arm.stateCorrect} / ${arm.expected}`],
        ["Behavior failures", arm.behaviorFailures], ["Unavailable or not observed", arm.unavailable],
        ["Estimated total cost", usd(arm.costUsd)], ["Cost per successful task", usd(arm.costPerSuccessUsd)],
        ["Known cost lower bound", usd(arm.knownCostLowerBoundUsd)], ["Provider attempts", arm.attempts], ["Attempts with unknown usage", arm.unknownAttempts],
        ["Case latency p50 / p95", `${ms(arm.p50Ms)} / ${ms(arm.p95Ms)}`], ["Known latency observations", arm.latencyObservations],
        ["Descriptive 95% pass interval", arm.descriptiveInterval95.map(v => `${(v * 100).toFixed(1)}%`).join(" – ")],
      ].map(([label, value]) => <div className="flex flex-wrap justify-between gap-3" key={label}><dt className="text-(--ad-muted)">{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>)}</div>
    <p className="text-sm text-(--ad-muted)">Costs include all recorded trials and retries; incomplete billing leaves totals and cost per success unknown. Latency percentiles use only recorded durations, including failed trials. State correctness is shown separately from answer/tool-policy checks.</p>
    <section className="space-y-3"><h2 className="font-semibold">Version comparison</h2>
      <div className="flex flex-wrap gap-3">{data.previous.map(p => <Link key={p.id} className="text-sm underline" href={`/benchmarks/${data.id}?compareTo=${p.id}`}>Compare {p.createdAt.slice(0, 10)} · {p.status} · {p.id.slice(0, 6)}</Link>)}</div>
      {data.previous.length === 0 && <p className="text-sm text-(--ad-muted)">Run another comparison after a draft revision to compare versions on a matching workload.</p>}
      {data.comparison && <div className="space-y-2 text-sm"><p>Previous v{data.comparison.version} · {data.comparison.status}</p>
        {data.comparison.reason && <p className="text-(--ad-approval)">{data.comparison.reason}</p>}
        {data.comparison.arms.map(a => <p key={a.arm}>{a.arm}: {a.passed}/{a.expected} passed · cost per success {usd(a.costPerSuccessUsd)} · case p95 {ms(a.p95Ms)}</p>)}
      </div>}
    </section>
    <section className="space-y-4"><h2 className="font-semibold">Paired tasks and retained evidence</h2>{data.children.map(child => <article className="space-y-3 rounded-xl border border-(--ad-border) p-4" key={child.ordinal}>
      <h3 className="font-medium">{child.arm} · repeat {child.repeat} · {child.job?.status ?? "Unavailable"}</h3>
      {!child.report?.results.length && <p className="text-sm text-(--ad-muted)">No completed case evidence recorded.</p>}
      {child.report?.results.map(result => <details key={result.testCaseId}><summary className="cursor-pointer text-sm">{data.cases.find(c => c.id === result.testCaseId)?.input ?? result.testCaseId} · {OUTCOME_LABELS[evaluationOutcome(result)]}</summary>
        <p className="my-2 whitespace-pre-wrap text-sm">{result.response ?? "No answer recorded"}</p><p className="text-sm text-(--ad-error)">{result.failures.join("; ")}</p>
        {result.runId && <Link className="my-2 inline-block text-sm underline" href={`/runs/${result.runId}`}>Actual model attempts and trace</Link>}<StateDiff evidence={result.stateEvidence} />
      </details>)}
    </article>)}</section>
    {!terminal && <Button variant="danger" onClick={async () => {
      try { const response = await fetch(`/api/benchmarks/${data.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (!response.ok) throw new Error(); }
      catch { setError("Could not request cancellation. Try again."); }
    }}>Stop comparison</Button>}
    {data.reason && <p className="text-sm text-(--ad-error)">Stopped: {data.reason}. Completed observations remain available.</p>}
    {error && <p role="alert" className="text-sm text-(--ad-error)">{error}</p>}
  </main>;
}
