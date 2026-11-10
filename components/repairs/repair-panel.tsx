"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import type { repairView } from "@/lib/repairs/service";
import type { TestRunReport } from "@/lib/evals/types";
import { evaluationOutcome, OUTCOME_LABELS } from "@/lib/evals/outcome";
import { StateDiff } from "@/components/tests/state-diff";

type View = Awaited<ReturnType<typeof repairView>>;
const finished = ["verified", "failed", "cancelled", "rejected"];
const labels: Record<string, string> = { queued: "Inspecting reproduction", review: "Suggested · waiting for your review", applied: "Applied · retest not finished", evaluating: "Applied · evaluating regression and baseline", verified: "Verified against the saved suite", failed: "Not verified", cancelled: "Cancelled", rejected: "Rejected" };
export function RepairPanel({ initial }: { initial: View }) {
  const [data, setData] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    if (finished.includes(data.status)) return;
    let active = true; let pending = false;
    const refresh = async () => {
      if (pending) return; pending = true;
      try { const response = await fetch(`/api/repairs/${data.id}`, { cache: "no-store" }); if (!response.ok) throw new Error();
        const next = await response.json(); if (active) { setData(next); setError(""); }
      } catch { if (active) setError("Connection interrupted. Reconnecting to the saved repair…"); } finally { pending = false; }
    };
    const timer = setInterval(() => { void refresh(); }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [data.id, data.status]);
  async function act(action: "approve" | "reject" | "cancel") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/repairs/${data.id}/${action === "cancel" ? "cancel" : "decision"}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "cancel" ? {} : { approved: action === "approve", proposalHash: data.proposalHash }) });
      if (!response.ok) throw new Error();
      const refreshed = await fetch(`/api/repairs/${data.id}`, { cache: "no-store" }); if (!refreshed.ok) throw new Error(); setData(await refreshed.json());
    } catch { setError("Could not record the decision. The draft, policy, tests or proposal may have changed. Reload and review again."); }
    finally { setBusy(false); }
  }
  const reports = (data.evaluations.length ? data.evaluations : data.child ? [data.child] : [])
    .map(e => e.result as unknown as TestRunReport | null).filter((r): r is TestRunReport => !!r && Array.isArray(r.results));
  const baseline = data.baseline as TestRunReport | null;
  return <main className="space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Review repair</h1><p className="mt-2 text-sm text-(--ad-muted)" role="status">{labels[data.status] ?? data.status}</p></div>
      <ButtonLink href={`/agents/${data.agentId}/tests`}>Open Evaluation Lab</ButtonLink></div>
    <p className="text-sm">This suggestion appends your reviewed requirement to Draft v{data.baseVersion}. Tools, model settings and limits are preserved. Approving creates a new draft and runs the full saved suite. The full suite runs {data.repeats} time(s), using the normal provider budget.</p>
    <Link className="text-sm underline" href={`/runs/${data.sourceRunId}`}>Inspect source run</Link>
    <div className="grid gap-4 lg:grid-cols-2">{[[`Current · v${data.baseVersion}`, data.before], ["Proposed instructions", data.after]].map(([title, text]) => <section className="rounded-xl border border-(--ad-border) p-4" key={title}><h2 className="mb-3 font-semibold">{title}</h2><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{text}</pre></section>)}</div>
    {data.status === "review" && data.approved === null && <div className="space-y-3"><p className="text-sm text-(--ad-muted)">Review expires {new Date(data.expiresAt).toLocaleString()}. Approval applies only to this exact proposal and its saved base.</p><div className="flex flex-wrap gap-3">
      <Button variant="primary" disabled={busy || data.expired} onClick={() => act("approve")}>Approve new draft and retest</Button>
      <Button disabled={busy} onClick={() => act("reject")}>Reject proposal</Button></div></div>}
    {data.approved !== null && <p className="text-sm">Review decision: {data.approved ? "Approved" : "Rejected"}{data.appliedVersion ? ` · Applied as Draft v${data.appliedVersion}` : ""}</p>}
    {!finished.includes(data.status) && <Button variant="danger" disabled={busy} onClick={() => act("cancel")}>Cancel repair</Button>}
    {data.reason && <p className="text-sm text-(--ad-error)">Repair stopped: {data.reason}. Any applied draft remains editable; fresh passing evidence is still required.</p>}
    <section className="space-y-4"><h2 className="font-semibold">Regression and baseline comparison</h2>
      <p className="text-sm text-(--ad-muted)">Every saved case is rerun, including the useful baseline cases. Missing or unavailable evidence cannot verify the fix.</p>
      {reports.length > 0 ? reports.map((report, index) => <section key={index} className="space-y-4"><h3 className="font-medium">Full-suite retest {index + 1}</h3>{report.results.map(result => {
        const previous = baseline?.results?.find(r => r.testCaseId === result.testCaseId);
        return <article className="rounded-xl border border-(--ad-border) p-4" key={result.testCaseId}>
          <h3 className="font-medium">{result.testCaseId === data.testCaseId ? "Reviewed regression" : "Baseline case"}</h3>
          <p className="mt-1 text-sm">{previous ? OUTCOME_LABELS[evaluationOutcome(previous)] : "No prior result"} → {OUTCOME_LABELS[evaluationOutcome(result)]}</p>
          {result.failures.length > 0 && <p className="mt-2 text-sm text-(--ad-error)">{result.failures.join("; ")}</p>}
          {result.runId && <Link className="mt-2 inline-block text-sm underline" href={`/runs/${result.runId}`}>Inspect new trace</Link>}
          <StateDiff evidence={result.stateEvidence} />
        </article>;
      })}</section>) : <p className="text-sm text-(--ad-muted)">No completed retest evidence yet.</p>}
    </section>
    {data.status === "verified" && <p className="text-sm">The retest passed the publication gate when it completed. Open Evaluation Lab to review and promote; promotion checks current evidence again.</p>}
    {error && <p role="alert" className="text-sm text-(--ad-error)">{error}</p>}
  </main>;
}
