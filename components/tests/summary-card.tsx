"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Backlit } from "@/components/ui/backlit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ClockIcon, LockIcon, PlayIcon, PlusIcon } from "@/components/ui/icons";
import type { AgentHeaderData } from "@/lib/fixtures/runs";
import { simulateTestRun } from "@/lib/fixtures/tests";
import type { QualitySummary, TestCase, TestCaseStatus, TestResult, TestRunReport } from "@/lib/evals/types";
import { formatCost, formatDuration, formatRelative } from "@/lib/runs/format";
import type { PublishStatus } from "@/lib/evals/publish-gate";
import type { TestCaseInput } from "@/lib/evals/schema";
import { AddTestDialog, fieldErrorsFrom, type FieldErrors } from "./add-test-dialog";
import { PublishBanner } from "./publish-banner";
import { QualityCard } from "./quality-card";
import { TestCaseCard } from "./test-case-card";

const barTone: Record<TestCaseStatus, string> = {
  passed: "bg-(--ad-success)", failed: "bg-(--ad-error)", error: "bg-(--ad-error)/50",
  running: "bg-(--ad-model) animate-pulse", pending: "bg-(--ad-border)",
};

type Meta = Pick<TestRunReport, "version" | "ranAt" | "durationMs" | "costUsd">;

export function SummaryCard({ version, statuses, meta, now, busy, canPublish, lockReason, publishing, onRun, onPublish }: {
  version: number; statuses: TestCaseStatus[]; meta: Meta | null; now: number; busy: boolean; canPublish: boolean;
  /** Why Publish is locked; shown as the button tooltip. */
  lockReason: string; publishing?: boolean;
  onRun: () => void; onPublish: () => void;
}) {
  const passed = statuses.filter(s => s === "passed").length;
  const failing = statuses.filter(s => s === "failed" || s === "error").length;
  const tested = busy || !!meta;
  return (
    <Backlit edge="top">
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-5 p-5 sm:p-6">
        <div>
          <p className="ad-mono text-[11px] font-medium tracking-wider text-(--ad-muted) uppercase">
            {busy ? "Running tests" : "Last test run"} · v{version}
          </p>
          <p className="mt-2 flex items-baseline gap-3">
            <span className="ad-mono text-3xl font-semibold">{tested ? `${passed} / ${statuses.length} passed` : "Not tested yet"}</span>
            {tested && failing > 0 && <span className="flex items-center gap-1.5 text-sm text-(--ad-error)"><span className="h-1.5 w-1.5 rounded-full bg-(--ad-error)" aria-hidden="true" />{failing} not passing</span>}
          </p>
        </div>
        <div>
          <p className="ad-mono text-[11px] font-medium tracking-wider text-(--ad-muted) uppercase">Execution sequence</p>
          <div className="mt-3 flex gap-1.5" role="img" aria-label={`${passed} passed, ${failing} not passing, ${statuses.length - passed - failing} not run`}>
            {statuses.map((s, i) => <span key={i} className={cn("h-2 w-12 rounded-sm", barTone[s])} />)}
          </div>
        </div>
        {meta && (
          <div className="ad-mono border-(--ad-border) text-[13px] text-(--ad-muted) sm:border-l sm:pl-8">
            <p>ran {formatRelative(meta.ranAt, now)}</p>
            <p className="mt-1.5 flex items-center gap-2 text-(--ad-text)"><ClockIcon size={14} /> {formatDuration(meta.durationMs)} · {formatCost(meta.costUsd)}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-3 sm:ml-auto">
          <Button onClick={onRun} disabled={busy || !statuses.length}><PlayIcon size={14} /> {busy ? "Running…" : "Run tests"}</Button>
          <Button variant="primary" onClick={onPublish} disabled={!canPublish || busy || publishing} title={canPublish ? undefined : lockReason}
            aria-describedby={canPublish ? undefined : "publish-lock-reason"}>
            {!canPublish && <LockIcon size={14} />} {publishing ? "Publishing…" : `Publish v${version}`}
          </Button>
          {!canPublish && <span id="publish-lock-reason" className="sr-only">{lockReason}</span>}
        </div>
      </Card>
    </Backlit>
  );
}

type RequestResult = { ok: true; data: unknown } | { ok: false; errors: FieldErrors };

const apiErrors: Record<string, string> = {
  agent_not_found: "This agent no longer exists.",
  test_not_found: "This test case no longer exists. Refresh the page.",
};

/** JSON request to the test case routes; maps 400 issues to field errors and other failures to a form message. */
async function request(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<RequestResult> {
  try {
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (res.ok) return { ok: true, data: res.status === 204 ? null : await res.json() };
    const err = await res.json().catch(() => null) as { error?: string; issues?: Array<{ path: PropertyKey[]; message: string }> } | null;
    const fields = err?.issues?.length ? fieldErrorsFrom(err.issues) : {};
    return { ok: false, errors: Object.keys(fields).length ? fields : { form: apiErrors[err?.error ?? ""] ?? "Could not save the test case. Try again." } };
  } catch {
    return { ok: false, errors: { form: "Network error. Check your connection and try again." } };
  }
}

/** Evaluation Lab screen state: cases, the latest results, running a suite, and the publish gate. */
export function TestsScreen({ agent, initialCases, report, quality, tools, now, persist, publish }: {
  agent: AgentHeaderData; initialCases: TestCase[]; report: TestRunReport | null; quality: QualitySummary; tools: readonly string[]; now: number;
  /** true: saves go through /api (database); false: fixture mode, changes stay on this page. */
  persist: boolean;
  /** Server publish gate (database mode). Only a saved, passing TestRun for this version unlocks Publish. */
  publish?: PublishStatus;
}) {
  const router = useRouter();
  const [cases, setCases] = useState(initialCases);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<Record<string, TestResult>>(() => Object.fromEntries((report?.results ?? []).map(r => [r.testCaseId, r])));
  const [running, setRunning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(report);
  const [clock, setClock] = useState(now);
  const [filter, setFilter] = useState<"all" | "failing" | "passed">("all");
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TestCase | null>(null);
  const formRef = useRef<HTMLTextAreaElement>(null);

  const statusOf = (c: TestCase): TestCaseStatus => running === c.id ? "running" : results[c.id]?.status ?? "pending";
  const statuses = cases.map(statusOf);
  const failingCases = cases.filter(c => ["failed", "error"].includes(statusOf(c)));
  const passedCount = statuses.filter(s => s === "passed").length;
  const allPassed = cases.length > 0 && passedCount === cases.length;
  const version = publish?.agentVersion ?? agent.version;
  // Database mode trusts only the server gate; fixture mode keeps the local all-passed rule.
  const canPublish = publish ? publish.canPublish : allPassed;
  const lockReason = publish ? publish.reason
    : !cases.length ? "Add at least one test before publishing"
    : failingCases.length ? `${failingCases.length} test${failingCases.length === 1 ? "" : "s"} failing` : "Every test must pass first";
  const visible = useMemo(() => cases.filter(c => {
    const s = running === c.id ? "running" : results[c.id]?.status;
    return filter === "all" || (filter === "passed" ? s === "passed" : s === "failed" || s === "error");
  }), [cases, results, running, filter]);

  const runTests = async () => {
    setBusy(true); setResults({}); setDismissed(false); setNotice(null);
    const r = await simulateTestRun(version, cases, u => {
      if (u.status === "running") setRunning(u.testCaseId);
      else { setRunning(null); setResults(prev => ({ ...prev, [u.testCaseId]: u })); }
    });
    setMeta(r); setClock(Date.now()); setBusy(false);
    // PLACEHOLDER: the real runner (POST /api/agents/[id]/tests/run) will save a TestRun; until then nothing is saved.
    if (persist) setNotice("Simulated run with fixture results: nothing was saved, so Publish still follows the last saved test run.");
  };

  /** Calls Dev 1's existing publish route; the button is only enabled when the server gate allows it. */
  const publishNow = async () => {
    setNotice(null); setActionError(null);
    if (!persist) { setNotice(`All tests pass. Publishing v${version} is not connected in fixture mode.`); return; }
    setPublishing(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testsPassed: true }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setNotice(`Published v${version}.`);
      router.refresh(); // re-reads the header's published badge from the server
    } catch {
      setActionError(`Could not publish v${version}. Try again.`);
    } finally {
      setPublishing(false);
    }
  };
  const forgetResult = (id: string) => setResults(prev => { const next = { ...prev }; delete next[id]; return next; });
  const editCase = (c: TestCase) => {
    setEditing(c);
    setTimeout(() => { formRef.current?.focus(); formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, 0);
  };

  /** Saves through the API when persisted (database mode); otherwise keeps the change on this page only. */
  const saveCase = async (input: TestCaseInput): Promise<FieldErrors | null> => {
    setActionError(null);
    if (!persist) {
      const saved: TestCase = { ...input, id: editing?.id ?? `local-${Date.now()}` };
      setCases(cs => editing ? cs.map(c => c.id === saved.id ? saved : c) : [...cs, saved]);
    } else {
      const res = editing ? await request(`/api/tests/${encodeURIComponent(editing.id)}`, "PATCH", input)
        : await request(`/api/agents/${encodeURIComponent(agent.id)}/tests`, "POST", input);
      if (!res.ok) return res.errors;
      const saved = res.data as TestCase;
      setCases(cs => editing ? cs.map(c => c.id === saved.id ? saved : c) : [...cs, saved]);
    }
    if (editing) { forgetResult(editing.id); setEditing(null); }
    return null;
  };
  const deleteCase = async (id: string) => {
    setActionError(null);
    if (persist) {
      const res = await request(`/api/tests/${encodeURIComponent(id)}`, "DELETE");
      if (!res.ok) { setActionError(res.errors.form ?? "Could not delete the test case."); return; }
    }
    setCases(cs => cs.filter(c => c.id !== id));
    forgetResult(id);
    if (editing?.id === id) setEditing(null);
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <SummaryCard version={version} statuses={statuses} meta={meta} now={clock} busy={busy} canPublish={canPublish}
        lockReason={lockReason} publishing={publishing} onRun={runTests} onPublish={publishNow} />
      {notice && <p role="status" className="rounded-xl border border-(--ad-success-border) bg-(--ad-success-bg) px-5 py-3 text-sm text-(--ad-success)">{notice}</p>}
      {actionError && <p role="alert" className="rounded-xl border border-(--ad-error-border) bg-(--ad-error-bg) px-5 py-3 text-sm text-(--ad-error)">{actionError}</p>}
      {!busy && !dismissed && !canPublish && (
        <PublishBanner reason={lockReason} publishedVersion={agent.publishedVersion}
          firstFailingId={failingCases[0]?.id} onDismiss={() => setDismissed(true)} />
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="test-cases-title" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-(--ad-border) pb-4">
            <h2 id="test-cases-title" className="text-[17px] font-semibold">Test cases</h2>
            <span className="ad-mono grid h-6 min-w-6 place-items-center rounded-full bg-(--ad-raised) px-2 text-xs">{cases.length}</span>
            <div className="flex rounded-lg border border-(--ad-border) p-1 text-sm" role="tablist" aria-label="Filter test cases">
              {([["all", "All"], ["failing", `Failing ${failingCases.length}`], ["passed", `Passed (${passedCount})`]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  className={cn("rounded-md px-3 py-1", filter === k ? "bg-(--ad-raised) text-(--ad-text)" : "text-(--ad-muted) hover:text-(--ad-text)",
                    k === "failing" && failingCases.length > 0 && filter !== k && "text-(--ad-error)")}>
                  {label}
                </button>
              ))}
            </div>
            <Button variant="dashed" className="ad-mono sm:ml-auto" onClick={() => {
              setEditing(null);
              setTimeout(() => { formRef.current?.focus(); formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, 0);
            }}>
              <PlusIcon size={14} /> Add test case
            </Button>
          </div>
          {visible.map(c => (
            <TestCaseCard key={c.id} testCase={c} status={statusOf(c)} result={results[c.id]} editing={editing?.id === c.id}
              onEdit={busy ? undefined : () => editCase(c)} onDelete={busy ? undefined : () => deleteCase(c.id)} />
          ))}
          {!visible.length && <p className="rounded-xl border border-dashed border-(--ad-border) py-10 text-center text-sm text-(--ad-muted)">No test cases here.</p>}
        </section>

        <aside className="space-y-5">
          <QualityCard version={version} passRate={meta && cases.length ? passedCount / cases.length : null} quality={quality} />
          <AddTestDialog key={editing?.id ?? "new"} tools={tools} initial={editing} onSubmit={saveCase}
            onCancel={() => setEditing(null)} inputRef={formRef} />
        </aside>
      </div>
    </div>
  );
}
