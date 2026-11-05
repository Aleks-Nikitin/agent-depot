import type { StateEvidence } from "@/lib/evals/state/evidence";
import type { StateAssertion } from "@/lib/evals/state/schema";

function assertionLabel(a: StateAssertion) {
  const filter = a.where && Object.keys(a.where).length ? ` matching ${JSON.stringify(a.where)}` : "";
  if (a.kind === "count") return `${a.table}${filter}: exactly ${a.equals} record(s)`;
  if (a.kind === "unchanged") return `${a.table}${filter}: unchanged`;
  return `${a.table}${filter}: exactly ${a.count} record(s) with ${JSON.stringify(a.fields)}`;
}

/** Only application-owned fixture snapshots are shown here, never framework checkpoint state. */
export function StateDiff({ evidence }: { evidence?: StateEvidence }) {
  if (!evidence) return <p className="border-t border-(--ad-border) p-5 text-sm text-(--ad-muted)">Database evidence was not recorded for this result. Run tests again to capture it.</p>;
  return (
    <details className="border-t border-(--ad-border) p-5" open={!evidence.passed}>
      <summary className="cursor-pointer text-sm font-semibold">Database changes · {evidence.passed ? "State checks passed" : "State checks failed"}</summary>
      {!evidence.sourceCompleted && <p className="mt-3 text-sm text-(--ad-error)">Execution did not complete. These snapshots cannot certify a pass.</p>}
      {!evidence.ownershipValid && <p className="mt-3 text-sm text-(--ad-error)">Unexpected record ownership. Promotion is blocked.</p>}
      <ul className="my-4 space-y-2 text-sm" aria-label="Database assertions">
        {evidence.assertions.map(({ assertion, passed }, i) => <li key={i} className={passed ? "text-(--ad-success)" : "text-(--ad-error)"}>
          <span className="font-semibold">{passed ? "Passed" : "Failed"}: </span>{assertionLabel(assertion)}
        </li>)}
      </ul>
      <p className="mb-3 text-xs text-(--ad-muted)">Disposable test data, captured before cleanup. Expand snapshots to inspect every field.</p>
      {(["tickets", "orders", "knowledge"] as const).map(table => {
        const before = evidence.before[table]; const after = evidence.after[table];
        const old = new Map(before.map(row => [row.id, row])); const next = new Map(after.map(row => [row.id, row]));
        const added = after.filter(row => !old.has(row.id)); const removed = before.filter(row => !next.has(row.id));
        const changed = after.filter(row => {
          const previous = old.get(row.id);
          return previous && Object.entries(row).some(([key, value]) => (previous as Record<string, unknown>)[key] !== value);
        });
        return <section key={table} aria-label={`${table} database diff`} className="mt-4 rounded-lg border border-(--ad-border) p-3">
          <h4 className="text-sm font-semibold capitalize">{table}</h4>
          <p className="my-2 text-xs text-(--ad-muted)">{added.length} added · {removed.length} removed · {changed.length} changed</p>
          {!added.length && !removed.length && !changed.length && <p className="text-sm text-(--ad-muted)">No database changes.</p>}
          {[...added.map(row => ({ id: row.id, label: "Added", before: null, after: row })),
            ...removed.map(row => ({ id: row.id, label: "Removed", before: row, after: null })),
            ...changed.map(row => ({ id: row.id, label: "Changed", before: old.get(row.id), after: row }))].map(change => (
            <div key={change.id} className="mt-3 rounded border border-(--ad-border) p-3">
              <p className="break-all text-xs font-semibold">{change.label} · {change.id}</p>
              <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                <Snapshot label="Before" value={change.before} />
                <Snapshot label="After" value={change.after} />
              </div>
            </div>
          ))}
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer">Full snapshots · {before.length} before / {after.length} after</summary>
            <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2"><Snapshot label="Before" value={before} /><Snapshot label="After" value={after} /></div>
          </details>
        </section>;
      })}
    </details>
  );
}

function Snapshot({ label, value }: { label: string; value: unknown }) {
  return <div className="min-w-0 rounded bg-(--ad-bg) p-3"><p className="mb-2 text-xs font-semibold">{label}</p>
    <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap break-all">{value == null ? "No record" : JSON.stringify(value, null, 2)}</pre></div>;
}
