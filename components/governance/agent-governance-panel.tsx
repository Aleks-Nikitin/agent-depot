"use client";
import { useState } from "react";
import Link from "next/link";
import type { AgentConfig } from "@/lib/agents/contracts";
import type { governanceView, previewAssignment } from "@/lib/governance/service";
export function AgentGovernancePanel({ agentId, initialVersion, binding, library }: { agentId: string; initialVersion: number; binding: AgentConfig["governance"] | null; library: Awaited<ReturnType<typeof governanceView>> }) {
 const [teamId, setTeamId] = useState(binding?.teamId ?? ""), [version, setVersion] = useState(initialVersion), [packs, setPacks] = useState(binding?.packs.map(p => `${p.id}:${p.version}`) ?? []);
 const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewAssignment>> | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
 const org = library.organizations.find(o => o.teams.some(t => t.id === teamId));
 const input = { expectedVersion: version, teamId: teamId || null, packs: packs.map(p => { const [id, version] = p.split(":"); return { id, version: Number(version) }; }) };
 async function submit(save: boolean) {
  setBusy(true);
  try {
   const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}/governance`, { method: save ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, ...(save ? { previewHash: preview?.previewHash } : {}) }) });
   const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "request_failed");
   if (save) { setVersion(data.version); setPreview(null); setMessage(`Saved governed draft v${data.version}. Run evaluations before promotion.`); } else { setPreview(data); setMessage(""); }
  } catch { setMessage("Could not apply this policy. Check team membership, review any denied fields, or reload after a policy/version change."); }
  finally { setBusy(false); }
 }
 return <section className="space-y-5 p-6"><h1 className="text-2xl font-semibold">Agent governance</h1><p>Review inherited permissions and shared packs before saving a new draft. <Link className="underline" href="/teams">Manage teams and shared libraries</Link></p>
 <label className="block">Team<select value={teamId} onChange={e => { setTeamId(e.target.value); setPacks([]); setPreview(null); }} className="ml-3 rounded border bg-(--ad-bg) p-2"><option value="">Personal agent · detachment requires organization admin</option>{library.organizations.flatMap(o => o.teams.map(t => <option key={t.id} value={t.id}>{o.name} / {t.name}</option>))}</select></label>
 <fieldset className="space-y-2"><legend>Versioned shared packs · select up to two</legend>{org?.packs.flatMap(p => p.versions.map(v => { const value = `${p.id}:${v.version}`; return <label key={value} className="flex gap-3"><input type="checkbox" checked={packs.includes(value)} disabled={!packs.includes(value) && packs.length >= 2} onChange={e => { setPacks(previous => e.target.checked ? [...previous, value] : previous.filter(x => x !== value)); setPreview(null); }} />{p.name} v{v.version} · {v.payload.scenarios.length} tests</label>; }))}</fieldset>
 <button disabled={busy} onClick={() => submit(false)} className="rounded border px-4 py-2">Preview permission changes</button>
 {preview && <div className="space-y-3 rounded-xl border border-(--ad-border) p-4"><h2 className="font-semibold">Permission review</h2><p>Tools: {preview.diff.toolsBefore.join(", ") || "none"} → {preview.diff.toolsAfter.join(", ") || "none"}</p><p>{preview.diff.addedScenarios} new test scenarios. Write review: {preview.diff.requireWriteApproval ? "required except explicitly exempt internal tools" : "per tool policy"}.</p>
 {preview.diff.provenance && <p>Organization {preview.diff.provenance.organizationName} v{preview.diff.provenance.organizationRevision} → Team {preview.diff.provenance.teamName} v{preview.diff.provenance.teamRevision} → Agent v{version + 1}</p>}
 <ul className="space-y-1 text-sm">{Object.entries(preview.diff.limitsAfter).map(([key, value]) => <li key={key}>{key}: {preview.diff.limitsBefore[key as keyof typeof preview.diff.limitsBefore]} → {value}</li>)}</ul>
 {!!preview.diff.provenance?.mandatoryRules.length && <details><summary>Mandatory inherited instructions</summary>{preview.diff.provenance.mandatoryRules.map((r, i) => <p key={i} className="mt-2 whitespace-pre-wrap text-sm">{r}</p>)}</details>}
 {preview.diff.violations.map((v, i) => <p key={i} role="alert" className="text-sm text-(--ad-error)">{v.field} denied by {v.sources.join(" → ")}. Requested: {JSON.stringify(v.requested)}. Permitted: {JSON.stringify(v.permitted)}.</p>)}
 <button disabled={busy || !!preview.diff.violations.length} onClick={() => submit(true)} className="rounded-lg bg-(--ad-ice) px-4 py-2 text-(--ad-bg)">Confirm reviewed changes</button></div>}
 <p role="status">{message}</p></section>;
}
