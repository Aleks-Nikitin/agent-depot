"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { routingView } from "@/lib/routing/service";
import type { RoutingPolicy } from "@/lib/routing/policy";
import type { ModelProfileId } from "@/lib/agents/profiles";
const profiles: ModelProfileId[] = ["gemini-primary", "openai-fallback"];
const field = "mt-1 w-full rounded-lg border border-(--ad-border) bg-(--ad-raised) p-2 text-sm";
const initialPolicy: RoutingPolicy = { version: 1, mode: "locked", approvedProfiles: ["gemini-primary"], lockedProfile: "gemini-primary",
  minContextTokens: 8192, allowedProviders: ["google"], dataPolicyTag: "", maxExpectedLatencyMs: 10000, maxCostTier: "standard" };
export function RoutingPanel({ initial }: { initial: Awaited<ReturnType<typeof routingView>> }) {
  const router = useRouter(); const [data, setData] = useState(initial); const [policy, setPolicy] = useState(initial.routing ?? { ...initialPolicy, approvedProfiles: [initial.primaryProfile], lockedProfile: initial.primaryProfile });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [acknowledged, setAcknowledged] = useState(false); const [repeats, setRepeats] = useState(2);
  async function save(clear = false) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/agents/${data.agentId}/routing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: data.version, routing: clear ? null : policy }) });
      if (!response.ok) throw new Error();
      const refreshed = await fetch(`/api/agents/${data.agentId}/routing`, { cache: "no-store" }); if (!refreshed.ok) throw new Error();
      setData(await refreshed.json()); router.refresh();
    } catch { setError("Could not save. Check the declared profile capabilities, allowed providers and current draft version."); } finally { setBusy(false); }
  }
  async function benchmark() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/agents/${data.agentId}/benchmarks`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: data.version, repeats, heldOutAcknowledged: acknowledged }) });
      const value = await response.json(); if (!response.ok) throw new Error(); router.push(`/benchmarks/${value.id}`);
    } catch { setError("Could not start. Save an eligible routing policy, ensure the primary profile is approved, and wait for any existing comparison to finish."); setBusy(false); }
  }
  return <div className="space-y-6 p-4 sm:p-6">
    <header><h1 className="text-2xl font-semibold">Model routing & comparisons</h1><p className="mt-2 text-sm text-(--ad-muted)">Draft v{data.version} · {data.routing ? "Routing enabled" : "Original model selection"}. Saving creates a new draft; the serving release stays unchanged.</p></header>
    <section className="space-y-4 rounded-xl border border-(--ad-border) bg-(--ad-surface) p-5">
      <h2 className="font-semibold">Routing policy</h2><p className="text-sm text-(--ad-muted)">Select the lowest estimated cost at the declared context size, or lock a profile. No router model is called. Operator latency/capacity declarations are constraints, not guarantees.</p>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Selection<select className={field} value={policy.mode} onChange={e => setPolicy({ ...policy, mode: e.target.value as RoutingPolicy["mode"] })}><option value="locked">Lock a profile</option><option value="lowest-estimated-cost">Lowest declared-context cost</option></select></label>
        <label className="text-sm">Locked profile<select className={field} disabled={policy.mode !== "locked"} value={policy.lockedProfile ?? data.primaryProfile} onChange={e => setPolicy({ ...policy, lockedProfile: e.target.value as ModelProfileId })}>{profiles.map(p => <option key={p}>{p}</option>)}</select></label>
        <label className="text-sm">Minimum context capacity<input className={field} type="number" min={1024} max={2000000} value={policy.minContextTokens} onChange={e => setPolicy({ ...policy, minContextTokens: Number(e.target.value) })} /></label>
        <label className="text-sm">Maximum declared latency (ms)<input className={field} type="number" min={100} max={120000} value={policy.maxExpectedLatencyMs} onChange={e => setPolicy({ ...policy, maxExpectedLatencyMs: Number(e.target.value) })} /></label>
        <label className="text-sm">Required data-policy tag<input className={field} maxLength={50} value={policy.dataPolicyTag} onChange={e => setPolicy({ ...policy, dataPolicyTag: e.target.value })} /></label>
        <label className="text-sm">Highest approved cost tier<select className={field} value={policy.maxCostTier} onChange={e => setPolicy({ ...policy, maxCostTier: e.target.value as RoutingPolicy["maxCostTier"] })}>{["economy", "standard", "premium"].map(t => <option key={t}>{t}</option>)}</select></label></div>
      <fieldset><legend className="text-sm font-medium">Approved profiles</legend>{profiles.map(p => <label className="mt-1 flex gap-2 text-sm" key={p}><input type="checkbox" checked={policy.approvedProfiles.includes(p)} onChange={e => setPolicy({ ...policy, approvedProfiles: e.target.checked ? [...policy.approvedProfiles, p] : policy.approvedProfiles.filter(v => v !== p) })} />{p}</label>)}</fieldset>
      <fieldset><legend className="text-sm font-medium">Allowed provider destinations</legend>{(["google", "openai"] as const).map(p => <label className="mt-1 flex gap-2 text-sm" key={p}><input type="checkbox" checked={policy.allowedProviders.includes(p)} onChange={e => setPolicy({ ...policy, allowedProviders: e.target.checked ? [...policy.allowedProviders, p] : policy.allowedProviders.filter(v => v !== p) })} />{p}</label>)}</fieldset>
      <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={busy} onClick={() => save()}>Save routing as new draft</Button>{data.routing && <Button disabled={busy} onClick={() => save(true)}>Restore original selection</Button>}</div>
      {data.decision && <div className="space-y-2 text-sm"><p>Saved selection: <strong>{data.decision.selectedProfile}</strong> · {data.decision.reason}</p>{data.decision.candidates.map(c => <p key={c.id}>{c.id}: {c.eligible ? "Eligible" : c.reason}</p>)}</div>}
      {data.reason && <p role="status" className="text-sm text-(--ad-muted)">{data.reason}. Ask the operator to configure model-bound capability declarations before enabling routing.</p>}
      <details><summary className="cursor-pointer text-sm">Operator profile declarations</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(data.catalog, null, 2)}</pre></details>
    </section>
    <section className="space-y-4 rounded-xl border border-(--ad-border) p-5"><h2 className="font-semibold">Primary-only versus routed</h2><p className="text-sm text-(--ad-muted)">Rerun the full saved suite on isolated data. Both arms use identical tasks and fixtures. Comparison results never authorize publication. Normal provider costs apply, up to four suites ($0.40 in suite limits), further bounded by workspace spend controls.</p>
      <label className="block text-sm">Repeats per arm<select className={field} value={repeats} onChange={e => setRepeats(Number(e.target.value))}><option value={1}>1 · two suites total</option><option value={2}>2 · four suites total</option></select></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I reviewed these saved cases as held-out tasks and will interpret repeated observations with their limitations.</label>
      <Button disabled={busy || !data.routing || !acknowledged} onClick={benchmark}>Run isolated comparison</Button>
      {data.benchmarks.map(b => <p key={b.id} className="text-sm"><Link className="underline" href={`/benchmarks/${b.id}`}>Recorded comparison · {b.status} · {b.createdAt.slice(0, 10)}</Link></p>)}
    </section>
    {error && <p role="alert" className="text-sm text-(--ad-error)">{error}</p>}
  </div>;
}
