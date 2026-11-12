"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TOOL_IDS, type TestCaseInput } from "@/lib/evals/schema";

type Preview = { agentId: string; sourceHash: string; definition: TestCaseInput; reusedOriginal: boolean; alreadySaved: string | null;
  evidence: { status: string; stopReason: string | null; manifestHash: string | null; result: { failures: string[]; outcome?: string } | null } };
const field = "mt-1 w-full rounded-lg border border-(--ad-border) bg-(--ad-raised) p-2 text-sm";
export function RegressionForm({ runId }: { runId: string }) {
  const [preview, setPreview] = useState<Preview>(); const [definition, setDefinition] = useState<TestCaseInput>();
  const [phrases, setPhrases] = useState("");
  const [saved, setSaved] = useState<string>(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/regression`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setPreview(data); setDefinition(data.definition); setPhrases(data.definition.mustContain.join("\n")); if (data.alreadySaved) setSaved(data.alreadySaved);
    } catch { setError("This run could not be opened for regression review."); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/regression`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceHash: preview!.sourceHash, definition: { ...definition, mustContain: phrases.split("\n").map(s => s.trim()).filter(Boolean) } }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSaved(data.testCaseId);
    } catch (e) { setError(e instanceof Error && e.message === "test_case_limit" ? "The suite is full. Remove a case in Tests before saving." : "Could not save. Review the checks and reload if the source changed."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border border-(--ad-border) p-5" aria-label="Regression review">
    <div><h2 className="font-semibold">Turn this run into a regression test</h2><p className="mt-1 text-sm text-(--ad-muted)">Review what should happen. Saving a test does not run a model or change the agent.</p></div>
    {!preview && <Button disabled={busy} onClick={load}>Create regression test from failed run</Button>}
    {preview && definition && !saved && <div className="space-y-4">
      <p className="text-sm text-(--ad-muted)">{preview.reusedOriginal ? "Original test fixtures and checks are included for review." : "Review new checks for this recorded input. Attempts in the trace are not assumed to be correct."}</p>
      <p className="whitespace-pre-wrap rounded-lg bg-(--ad-raised) p-3 text-sm">{definition.input}</p>
      {preview.evidence.result && <p className="text-sm">Recorded result: {preview.evidence.result.outcome ?? "unclassified"}. {preview.evidence.result.failures.join("; ")}</p>}
      <label className="block text-sm">Expected behavior (required)<textarea className={field} maxLength={2000} value={definition.expectedBehavior ?? ""} onChange={e => setDefinition({ ...definition, expectedBehavior: e.target.value })} /></label>
      <label className="block text-sm">Required answer phrases (one per line)<textarea className={field} value={phrases} onChange={e => setPhrases(e.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2">{(["mustCall", "mustNotCall"] as const).map(key => <fieldset key={key}><legend className="text-sm font-medium">{key === "mustCall" ? "Must attempt" : "Must never attempt"}</legend>
        {TOOL_IDS.map(tool => <label className="mt-1 flex gap-2 text-sm" key={tool}><input type="checkbox" checked={definition[key].includes(tool)} onChange={e => setDefinition({ ...definition, [key]: e.target.checked ? [...definition[key], tool] : definition[key].filter(t => t !== tool) })} />{tool}</label>)}</fieldset>)}</div>
      <label className="block text-sm">Expected total tickets (optional)<input className={field} type="number" min={0} max={200} value={definition.stateAssertions?.find(a => a.kind === "count" && a.table === "tickets" && !a.where)?.kind === "count" ? (definition.stateAssertions.find(a => a.kind === "count" && a.table === "tickets" && !a.where) as { equals: number }).equals : ""}
        onChange={e => setDefinition({ ...definition, stateAssertions: [...(definition.stateAssertions ?? []).filter(a => !(a.kind === "count" && a.table === "tickets" && !a.where)), ...(e.target.value === "" ? [] : [{ kind: "count" as const, table: "tickets" as const, equals: Number(e.target.value) }])] })} /></label>
      <details><summary className="cursor-pointer text-sm">Review isolated data and exact state checks</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ fixtures: definition.fixtures ?? {}, stateAssertions: definition.stateAssertions ?? [] }, null, 2)}</pre></details>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={definition.useGrader} onChange={e => setDefinition({ ...definition, useGrader: e.target.checked })} />Use semantic grading when running this test (provider costs apply)</label>
      <Button variant="primary" disabled={busy || !definition.expectedBehavior?.trim()} onClick={save}>Save reviewed regression</Button>
    </div>}
    {saved && preview && <div className="space-y-3"><p className="text-sm">Regression saved. It needs fresh evaluation before it can support publication.</p><Link className="text-sm underline" href={`/agents/${preview.agentId}/tests`}>Open tests</Link><RepairStarter runId={runId} /></div>}
    {error && <p role="alert" className="text-sm text-(--ad-error)">{error}</p>}
  </section>;
}
function RepairStarter({ runId }: { runId: string }) {
  const router = useRouter();
  const [repeats, setRepeats] = useState(1);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <div className="space-y-2"><label className="block text-sm">Full-suite retests <select className="ml-2 rounded border border-(--ad-border) bg-(--ad-raised) p-1" value={repeats} onChange={e => setRepeats(Number(e.target.value))}><option value={1}>Once</option><option value={2}>Twice</option></select></label><Button disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/repair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repeats }) });
      const data = await response.json(); if (!response.ok) throw new Error(); router.push(`/repairs/${data.id}`);
    } catch { setError("Could not start repair. Check the saved regression and current draft."); setBusy(false); }
  }}>Propose a reviewed repair</Button>{error && <p role="alert" className="mt-2 text-sm text-(--ad-error)">{error}</p>}</div>;
}
