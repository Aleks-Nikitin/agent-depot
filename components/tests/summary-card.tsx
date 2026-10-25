"use client";

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
import { AddTestDialog } from "./add-test-dialog";
import { PublishBanner } from "./publish-banner";
import { QualityCard } from "./quality-card";
import { TestCaseCard } from "./test-case-card";

const barTone: Record<TestCaseStatus, string> = {
  passed: "bg-(--ad-success)", failed: "bg-(--ad-error)", error: "bg-(--ad-error)/50",
  running: "bg-(--ad-model) animate-pulse", pending: "bg-(--ad-border)",
};

type Meta = Pick<TestRunReport, "version" | "ranAt" | "durationMs" | "costUsd">;

export function SummaryCard({ version, statuses, meta, now, busy, canPublish, onRun, onPublish }: {
  version: number; statuses: TestCaseStatus[]; meta: Meta | null; now: number; busy: boolean; canPublish: boolean;
  onRun: () => void; onPublish: () => void;
}) {
  const passed = statuses.filter(s => s === "passed").length;
  const failing = statuses.filter(s => s === "failed" || s === "error").length;
  return (
    <Backlit edge="top">
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-5 p-5 sm:p-6">
        <div>
          <p className="ad-mono text-[11px] font-medium tracking-wider text-(--ad-muted) uppercase">
            {busy ? "Running tests" : meta ? "Last test run" : "No test run yet"} · v{version}
          </p>
          <p className="mt-2 flex items-baseline gap-3">
            <span className="ad-mono text-3xl font-semibold">{passed} / {statuses.length} passed</span>
            {failing > 0 && <span className="flex items-center gap-1.5 text-sm text-(--ad-error)"><span className="h-1.5 w-1.5 rounded-full bg-(--ad-error)" aria-hidden="true" />{failing} not passing</span>}
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
          <Button variant="primary" onClick={onPublish} disabled={!canPublish || busy} title={canPublish ? undefined : "Every test must pass first"}>
            {!canPublish && <LockIcon size={14} />} Publish v{version}
          </Button>
        </div>
      </Card>
    </Backlit>
  );
}

/** Evaluation Lab screen state: cases, the latest results, running a suite, and the publish gate. */
export function TestsScreen({ agent, initialCases, report, quality, tools, now }: {
  agent: AgentHeaderData; initialCases: TestCase[]; report: TestRunReport | null; quality: QualitySummary; tools: string[]; now: number;
}) {
  const [cases, setCases] = useState(initialCases);
  const [results, setResults] = useState<Record<string, TestResult>>(() => Object.fromEntries((report?.results ?? []).map(r => [r.testCaseId, r])));
  const [running, setRunning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(report);
  const [clock, setClock] = useState(now);
  const [filter, setFilter] = useState<"all" | "failing" | "passed">("all");
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const formRef = useRef<HTMLTextAreaElement>(null);

  const statusOf = (c: TestCase): TestCaseStatus => running === c.id ? "running" : results[c.id]?.status ?? "pending";
  const statuses = cases.map(statusOf);
  const failingCases = cases.filter(c => ["failed", "error"].includes(statusOf(c)));
  const passedCount = statuses.filter(s => s === "passed").length;
  const allPassed = cases.length > 0 && passedCount === cases.length;
  const visible = useMemo(() => cases.filter(c => {
    const s = running === c.id ? "running" : results[c.id]?.status;
    return filter === "all" || (filter === "passed" ? s === "passed" : s === "failed" || s === "error");
  }), [cases, results, running, filter]);

  const runTests = async () => {
    setBusy(true); setResults({}); setDismissed(false); setNotice(null);
    const r = await simulateTestRun(agent.version, cases, u => {
      if (u.status === "running") setRunning(u.testCaseId);
      else { setRunning(null); setResults(prev => ({ ...prev, [u.testCaseId]: u })); }
    });
    setMeta(r); setClock(Date.now()); setBusy(false);
  };
  const addCase = (c: Omit<TestCase, "id">) => setCases(cs => [...cs, { ...c, id: `t-${cs.length + 1}-${c.input.length}` }]);
  const removeCase = (id: string) => {
    setCases(cs => cs.filter(c => c.id !== id));
    setResults(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <SummaryCard version={agent.version} statuses={statuses} meta={meta} now={clock} busy={busy} canPublish={allPassed}
        onRun={runTests}
        // PLACEHOLDER(P9): publish must be checked server-side against the latest passing TestRun.
        onPublish={() => setNotice(`All tests pass. Publishing v${agent.version} is not connected yet.`)} />
      {notice && <p role="status" className="rounded-xl border border-(--ad-success-border) bg-(--ad-success-bg) px-5 py-3 text-sm text-(--ad-success)">{notice}</p>}
      {!busy && !dismissed && failingCases.length > 0 && (
        <PublishBanner failing={failingCases.length} publishedVersion={agent.publishedVersion}
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
            <Button variant="dashed" className="ad-mono sm:ml-auto" onClick={() => { formRef.current?.focus(); formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }}>
              <PlusIcon size={14} /> Add test case
            </Button>
          </div>
          {visible.map(c => <TestCaseCard key={c.id} testCase={c} status={statusOf(c)} result={results[c.id]} onDelete={busy ? undefined : () => removeCase(c.id)} />)}
          {!visible.length && <p className="rounded-xl border border-dashed border-(--ad-border) py-10 text-center text-sm text-(--ad-muted)">No test cases here.</p>}
        </section>

        <aside className="space-y-5">
          <QualityCard version={agent.version} passRate={meta && cases.length ? passedCount / cases.length : null} quality={quality} />
          <AddTestDialog tools={tools} onSave={addCase} inputRef={formRef} />
        </aside>
      </div>
    </div>
  );
}
