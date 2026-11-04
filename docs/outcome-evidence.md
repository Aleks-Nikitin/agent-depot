# Deterministic outcome evidence

Saved evaluation cases support fixture seeds and deterministic state assertions. Every executed case records its actual before/after ticket, order and knowledge state, a database diff, and assertion results. A polite answer cannot override an incorrect effect. Publication requires complete, current, server-recorded evidence; client pass flags have no authority.

## Case contract

The existing authenticated test-case create/update APIs accept optional `fixtures` and `stateAssertions`. This example expects exactly one correctly named ticket and preserves the seeded order:

```json
{
  "input": "Create a ticket with subject Review 1042",
  "mustCall": ["create_ticket"],
  "fixtures": {
    "tickets": [],
    "orders": [
      { "id": "order-1042", "orderId": "1042", "status": "delivered", "totalCents": 4900, "currency": "USD" }
    ]
  },
  "stateAssertions": [
    { "kind": "count", "table": "tickets", "equals": 1 },
    { "kind": "record", "table": "tickets", "fields": { "subject": "Review 1042" } },
    { "kind": "unchanged", "table": "orders" }
  ]
}
```

Fixture seeds support tickets (`id`, `subject`, `idempotencyKey`), orders, products and knowledge (`documents`, `sample`). Omitted knowledge uses the owned suite snapshot; omitted collections retain the [isolated adapter defaults](isolated-evaluations.md). Owners and SQL namespaces are supplied by the server. Fixtures cannot select a database, owner or executor. Cases are limited to 2 MB, 100 seeds per collection, and 20 authored assertions. Partial updates preserve omitted saved fields. Duplicating an agent copies fixture/assertion definitions, with new case IDs and no copied evaluation evidence.

Assertions use only known flat fields in `tickets`, `orders` or `knowledge`:

- `count` requires an exact record count, optionally filtered by `where` field equality.
- `record` requires exactly `count` matching records (default 1), with every declared field equal to its expected value. `where` optionally selects the records.
- `unchanged` compares the full selected records before and after, including deletions, additions and field changes.

Filters and expected values accept schema-checked strings/numbers. They cannot execute JavaScript, SQL, arbitrary paths or model-provided evaluators. Snapshots sort by record ID, exclude volatile timestamps and compute added/removed/changed rows deterministically.

Current safety defaults always preserve seeded tickets, orders and knowledge and reject records belonging to another owner. The default total ticket count is the seed count, plus one when `mustCall` includes `create_ticket`. An explicit unfiltered ticket-count assertion overrides that default, allowing an intentional multi-ticket case. Field assertions add stricter business expectations. Missing effects, duplicate effects, wrong fields and forbidden changes fail independently of answer text. Unsupported mutation workflows need a reviewed policy/tool change rather than silently relaxing these defaults.

## Manifest and promotion gate

Each suite creates an immutable `EvaluationManifest` before model execution. Its hash binds:

- The exact normalized draft and owner/revision.
- Test definitions, fixture overrides and authored assertions.
- Runtime/evaluation policy declarations and configured limits.
- Enabled tools' declared implementation revisions, input/output schemas, classification and availability.
- Provider model/pricing/recovery settings and the captured knowledge snapshot.
- Resolved per-case fixture hashes and effective assertion hashes, including safety defaults.

`ToolDefinition.implementationVersion` and `EVALUATION_POLICY_REVISION` are explicit server declarations. Bump them when implementation or policy semantics change. These are versioned contracts, not an automatic source-code measurement. Unversioned enabled tools cannot generate new certification evidence.

Case results retain `stateEvidence` with snapshots, diff, assertion verdicts, run ID, manifest hash, owner and completion status, plus a content hash. The standard evaluation response and latest-report reader return this evidence to the authenticated owner. Private graph checkpoints, repository capabilities and connection credentials remain private. State is captured before disposable schemas are removed, then retained with suite results. Failed/cancelled runs retain available state but cannot count as a pass; unavailable snapshots, providers, graders or cleanup also cannot pass. Deterministic failures skip unnecessary semantic grading.

Promotion recomputes current manifest identity, expected seeded state, diffs and assertion results. It verifies every case's completed, owned, isolated runtime source, response and bounded configuration. It checks the private checkpoint's knowledge identity without exporting that checkpoint. It rejects missing, changed, partial, legacy or mismatched evidence even if stored pass flags say otherwise. Fresh evidence is required after fixture, assertion, draft, knowledge, tool revision, policy or model-setting changes. Suite results and their full manifest are copied into the immutable release artifact. Promotion uses a serializable transaction; conflicting dependency changes may return `409 evaluation_dependencies_changed`.

Existing approved releases keep their retained artifacts and serving pointers; failed drafts do not replace them. Release rollback still uses prior approval evidence. This change does not make live knowledge/domain data immutable after promotion, freeze tool code, or certify arbitrary workloads. It certifies the declared cases against their isolated fixtures. The dedicated visual state-diff editor is separate work; this change supplies its persisted API evidence.

## Setup and verification

Regenerate Prisma and deploy the additive case/manifest migrations before running evaluations. The existing isolated database setup remains required; no new database instance or provider package is needed. Old suite records without manifests/outcome evidence remain readable but cannot unlock a new promotion.

Local deterministic integration checks cover seeded state and CRUD preservation, exact counts/fields, missing/duplicate/incorrect effects, forbidden mutations, unchanged live ticket state, preserved serving releases, immutable manifests, tampered/missing proof rejection and dependency invalidation. They do not establish live provider, hosted database or deployment readiness.

Verification for this implementation: typecheck, lint, 119 unit tests and 21 focused PostgreSQL integration checks passed. The production build remains blocked by the execution environment denying the Turbopack CSS worker a local port bind. No bundler workaround, live model call, hosted write/read or deployment is claimed.
