import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { StateSnapshotSchema, type StateSnapshot, type StateAssertion } from "./schema";
import type { EvaluationFixtures } from "../isolation/fixtures";

export function normalizedSnapshot(value: unknown): StateSnapshot {
  const snapshot = StateSnapshotSchema.parse(value);
  for (const rows of Object.values(snapshot)) {
    rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("duplicate_state_record");
  }
  return snapshot;
}
export function fixtureSnapshot(fixtures: EvaluationFixtures, ownerId: string): StateSnapshot {
  return normalizedSnapshot({ tickets: fixtures.tickets.map(row => ({ ...row, ownerId })), orders: fixtures.orders.map(row => ({ ...row, ownerId })),
    knowledge: fixtures.knowledge.documents.map(row => ({ ...row, ownerId })) });
}
export function stateDiff(before: StateSnapshot, after: StateSnapshot) {
  return Object.fromEntries((Object.keys(before) as (keyof StateSnapshot)[]).map(table => {
    const old = new Map(before[table].map(row => [row.id, row])); const next = new Map(after[table].map(row => [row.id, row]));
    return [table, { added: after[table].filter(row => !old.has(row.id)), removed: before[table].filter(row => !next.has(row.id)),
      changed: after[table].filter(row => old.has(row.id) && artifactHash(old.get(row.id)) !== artifactHash(row)).map(row => ({ id: row.id, before: old.get(row.id)!, after: row })) }];
  }));
}
export function effectiveAssertions(test: { mustCall: string[]; stateAssertions?: StateAssertion[] }, before: StateSnapshot): StateAssertion[] {
  const custom = test.stateAssertions ?? [];
  return [
    { kind: "unchanged", table: "orders" }, { kind: "unchanged", table: "knowledge" },
    ...before.tickets.map(row => ({ kind: "unchanged" as const, table: "tickets" as const, where: { id: row.id } })),
    ...(custom.some(a => a.kind === "count" && a.table === "tickets" && (!a.where || Object.keys(a.where).length === 0)) ? [] : [{ kind: "count" as const, table: "tickets" as const, equals: before.tickets.length + (test.mustCall.includes("create_ticket") ? 1 : 0) }]),
    ...custom,
  ];
}
export function checkState(test: { mustCall: string[]; stateAssertions?: StateAssertion[] }, before: StateSnapshot, after: StateSnapshot, ownerId?: string) {
  const matches = (row: object, fields: Record<string, string | number> = {}) => Object.entries(fields).every(([key, value]) => Object.hasOwn(row, key) && (row as Record<string, unknown>)[key] === value);
  const assertions = effectiveAssertions(test, before).map(assertion => {
    const old = before[assertion.table].filter(row => matches(row, assertion.where));
    const next = after[assertion.table].filter(row => matches(row, assertion.where));
    const passed = assertion.kind === "count" ? next.length === assertion.equals
      : assertion.kind === "record" ? next.length === assertion.count && next.every(row => matches(row, assertion.fields))
      : artifactHash(old) === artifactHash(next);
    return { assertion, passed, reason: passed ? null : `State assertion failed: ${assertion.table} ${assertion.kind}` };
  });
  const ownershipValid = !ownerId || Object.values(after).every(rows => rows.every(row => row.ownerId === ownerId));
  return { diff: stateDiff(before, after), assertions, ownershipValid, passed: ownershipValid && assertions.every(result => result.passed) };
}
