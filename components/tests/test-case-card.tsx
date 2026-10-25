"use client";

import { useState, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { AlertIcon, CheckIcon, EditIcon, PlayIcon, SparkIcon, TrashIcon, XIcon } from "@/components/ui/icons";
import { Chip, Pill } from "@/components/ui/pill";
import { WRITE_TOOLS } from "@/lib/fixtures/runs";
import type { TestCase, TestCaseStatus, TestResult } from "@/lib/evals/types";
import { formatDuration } from "@/lib/runs/format";

const sourceLabel: Record<TestCase["source"], { text: string; icon: ReactNode }> = {
  gemini: { text: "Suggested by Gemini", icon: <SparkIcon size={13} /> },
  user: { text: "Added by you", icon: <EditIcon size={13} /> },
  template: { text: "From template", icon: <CheckIcon size={13} /> },
};

export function TestStatusPill({ status }: { status: TestCaseStatus }) {
  switch (status) {
    case "passed": return <Pill tone="success" icon={<CheckIcon size={12} />} className="ad-mono">Passed</Pill>;
    case "failed": return <Pill tone="error" icon={<XIcon size={12} />} className="ad-mono">Failed</Pill>;
    case "error": return <Pill tone="error" icon={<AlertIcon size={12} />} className="ad-mono">Not evaluated</Pill>;
    case "running": return <Pill tone="model" icon={<PlayIcon size={12} />} className="ad-mono">Running</Pill>;
    default: return <Pill className="ad-mono">Not run</Pill>;
  }
}

export function TestCaseCard({ testCase: c, status, result, onEdit, onDelete, editing }: {
  testCase: TestCase; status: TestCaseStatus; result?: TestResult; onEdit?: () => void; onDelete?: () => Promise<void> | void; editing?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const failing = status === "failed" || status === "error";
  const gatedWrite = c.mustCall.some(t => WRITE_TOOLS.has(t));
  const remove = async () => {
    setDeleting(true);
    try { await onDelete?.(); } finally { setDeleting(false); setConfirming(false); }
  };
  return (
    <article id={`test-${c.id}`} className={cn("scroll-mt-24 overflow-hidden rounded-xl border bg-(--ad-surface)",
      failing ? "border-(--ad-error-border)" : editing ? "border-(--ad-muted)/60" : "border-(--ad-border)")}>
      <div className="p-5">
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-[15px] font-semibold">&ldquo;{c.input}&rdquo;</h3>
          <TestStatusPill status={status} />
          {onEdit && (
            <button type="button" onClick={onEdit} aria-label="Edit test case" aria-pressed={editing}
              className="grid h-6 w-6 place-items-center rounded-md text-(--ad-muted) hover:bg-(--ad-raised) hover:text-(--ad-text)">
              <EditIcon size={14} />
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={() => setConfirming(true)} aria-label="Delete test case"
              className="grid h-6 w-6 place-items-center rounded-md text-(--ad-muted) hover:bg-(--ad-raised) hover:text-(--ad-error)">
              <TrashIcon size={14} />
            </button>
          )}
        </div>
        {confirming && (
          <div role="alertdialog" aria-label="Confirm delete"
            className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-(--ad-error-border) bg-(--ad-error-bg) px-4 py-3">
            <p className="flex-1 text-sm text-(--ad-error)">Delete this test case? This can&apos;t be undone.</p>
            <Button size="sm" variant="ghost" disabled={deleting} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" variant="danger" disabled={deleting} onClick={remove}>{deleting ? "Deleting…" : "Delete"}</Button>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {c.mustCall.map(t => <Chip key={`c-${t}`} tone="tool" dot>must call {t}</Chip>)}
          {c.mustNotCall.map(t => <Chip key={`n-${t}`}>must not call {t}</Chip>)}
          {c.mustContain.map(w => <Chip key={`w-${w}`}>contains &ldquo;{w}&rdquo;</Chip>)}
          {c.useGrader && <Chip tone="model" dot>Gemini grader: follows policy</Chip>}
          {gatedWrite && <Chip tone="approval">approval auto-rejected in tests</Chip>}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[13px] text-(--ad-muted)">
          {sourceLabel[c.source].icon} Source: {sourceLabel[c.source].text}
          {result?.durationMs != null && <span className="ad-mono">· Latency: {formatDuration(result.durationMs)}</span>}
        </p>
      </div>

      {c.expectedBehavior && <p className="px-5 pb-4 text-sm text-(--ad-muted)">Expected behavior: {c.expectedBehavior}</p>}
      {!failing && result?.runId && <div className="border-t border-(--ad-border) p-4"><ButtonLink href={`/runs/${result.runId}`} size="sm">View recorded test trace</ButtonLink></div>}
      {failing && result && (
        <div className="border-t border-(--ad-error-border) bg-(--ad-error-bg)/50 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="ad-mono text-[11px] font-medium tracking-wider text-(--ad-error) uppercase">
              {status === "error" ? "Not evaluated" : "Why it failed"}
            </span>
            {result.runId && <ButtonLink href={`/runs/${result.runId}`} size="sm" className="ad-mono">View trace</ButtonLink>}
          </div>
          <ul className="mt-3 space-y-1.5">
            {result.failures.map(f => (
              <li key={f} className="flex gap-2 text-sm text-(--ad-error)"><XIcon size={15} className="mt-0.5 shrink-0" />{f}</li>
            ))}
          </ul>
          {result.response && (
            <div className="mt-4 rounded-lg border border-(--ad-border) bg-(--ad-bg)/70 p-4">
              <p className="ad-mono text-xs text-(--ad-muted)">Agent said:</p>
              <p className="ad-mono mt-1.5 text-sm italic">&ldquo;{result.response}&rdquo;</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
