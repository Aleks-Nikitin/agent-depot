# Reviewed regression repair

A finished run can become an owned, reviewed regression test. From **Runs → run detail**, choose **Create regression test from failed run**, describe the expected behavior, and select deterministic tool, text or state checks. A completed runtime may still represent a failed business outcome; the owner must identify that invariant. The observed answer and attempted writes are never used as expected outcomes automatically.

The input stays pinned to the source run. When a source evaluation still matches the current suite fingerprint, its original fixtures and checks are copied for review. Otherwise the form starts with the recorded input and empty checks; review the isolated data before saving. An expected-behavior description alone does not enforce a deterministic check. Either add checks or explicitly select semantic grading, which uses the existing bounded provider service when evaluated. Default state checks continue to protect seeded records and reject unowned effects.

Saving records source revision/config hash, input, response, status, stop reason, trace hash and available suite/result/manifest evidence in a `RegressionOrigin`. It excludes private runtime checkpoints. Concurrent/repeated unchanged saves return one test; changed retry definitions conflict. The normal five-case cap applies atomically, and new tests invalidate publication evidence. Existing baseline cases are preserved.

## Repair and review

After saving, choose **Propose a reviewed repair**, with one or two full-suite retests. The first implementation deterministically appends the reviewed invariant to the current instructions. It does not call a model to invent a fix. The side-by-side review shows the exact instructions before and after. Enabled tools, model profiles, limits and write-approval policy remain identical. This produces a small, inspectable candidate; adding a requirement does not guarantee the model will obey it.

A separate, versioned LangGraph `StateGraph` runs:

1. Inspect the retained reproduction identity and source evidence hash.
2. Produce the minimal instruction diff.
3. Persist an interrupt for human review.
4. Apply the approved proposal as one new immutable draft.
5. Enqueue the full regression/baseline suite using the existing background evaluation worker.
6. Persist a second interrupt until evaluation settles, then inspect its evidence. Repeat the full suite only if the first passed and two retests were approved.
7. Report verification separately from suggestion, application and evaluation.

The session owner must approve the exact proposal hash. That hash binds the proposed configuration, base configuration, base evaluation manifest, source identity, regression definition and retest count. Review expires after 24 hours. A changed base, suite, knowledge, policy, tool identity, provider settings or proposal prevents application. Rejection and cancellation apply no further changes. Cancellation after application retains the new editable draft and cooperatively cancels an existing child evaluation; it does not roll back completed effects or already incurred charges.

Only a completed, passing child suite with the expected target manifest and a passing normal publication gate can verify a repair. Every saved case reruns, including useful baseline tasks. A failed/unavailable/cancelled/interrupted evaluation cannot verify it. The review page displays each retest's classifications, before/after database evidence and baseline comparison. No previous result is labeled explicitly. Verification certifies only the authored cases and recorded repeats; it does not establish general robustness.

Open **Evaluation Lab** to promote the repaired draft. Promotion checks current evidence again. Repair never changes the serving pointer or promotes itself. For example, a v2 agent that claims ticket creation without a write can produce a reviewed requirement to create exactly one correctly named ticket. Approval creates v3; the normal isolated suite must observe that exact record while preserving the baseline before v3 can be promoted.

## Persistence, billing and recovery

Run `npm run db:generate`, `DATABASE_TARGET=local npm run db:deploy`, `npm run runtime:setup` and `npm run worker:setup` before starting the web app and `npm run worker`. Apply migrations only to the intended database. `runtime:setup` explicitly prepares both vendor checkpoint schemas: `langgraph_checkpoints` for standard execution and **`langgraph_repairs`** for repair graphs. Repair threads use server-generated `repair:v1:<case-id>` identifiers. Unsupported stored graph versions are rejected. PostgreSQL checkpoints, application repair receipts and Graphile jobs all use the configured application database selector; no additional database service is required.

The worker serializes repair progression with a database advisory lock held for at most 30 seconds. Pre-review nodes perform no writes. Approval and its queue entry commit together. New draft creation and the applied-version receipt commit together, so replay after draft commit but before checkpoint persistence reuses exactly that draft. Child suite keys bind repair ID and repeat ordinal; enqueue and receipt reconciliation reuse an existing evaluation instead of starting it again. The target version and manifest are checked inside evaluation enqueue, before its snapshot commits. Each settled child wakes its parent, including redelivery and completion before the parent checkpoint saves.

Unexpected infrastructure/checkpoint failures retry the repair coordinator at most three times. Semantic failures stop safely. Exhausted coordinator attempts report failure. The child execution worker retains its existing conservative hard-crash behavior: an ambiguous model/effect is not blindly retried; such an evaluation fails verification. Repair does not grant additional provider retries or replace the standard `runAgent`/`resumeAgent` loop.

One repair has one approved proposal/application round and at most two complete suites. There is no billable proposal call. Retests use the existing per-case, suite and workspace reservations, concurrency limits, runtime deadlines and unknown-usage accounting. Each suite retains its $0.10 ceiling; two repeats cannot grant an unbounded repair loop. Budget or provider unavailability is failure evidence, never a pass. No new live-provider call is needed to create or review the suggestion.

Checkpoints, proposal payloads and source evidence remain private to the server/owner. Public responses deliberately select application review data, not checkpoint state or connection settings. Native graph payload tracing is suppressed through the existing privacy boundary; child runtime tracing remains metadata-only and optional. When explicitly enabled, repair-step metadata adds only case/child job references, graph version, node/status, applied version and suite count; optional telemetry failures do not block execution. Hosted repair tracing/export and automated retention are not verified. Operators should retain/delete case receipts and corresponding repair checkpoint threads together under their data policy; deleting application rows alone is not checkpoint cleanup.

## API

All routes require the authenticated owner. Mutations require the configured same-origin check. Responses use private/no-store caching.

- `GET /api/runs/:id/regression`: review preview and source hash.
- `POST /api/runs/:id/regression`: `{ sourceHash, definition }`, returning owned `testCaseId` and `agentId`.
- `POST /api/runs/:id/repair`: `{ repeats?: 1 | 2 }`, returning a 202 repair ID. Identical source/base/proposal requests reuse the same case.
- `GET /api/repairs/:id`: selected review, status, baseline and retest data.
- `POST /api/repairs/:id/decision`: `{ approved, proposalHash }`, returning 202. An unchanged decision is single-use/idempotent; a conflicting decision fails.
- `POST /api/repairs/:id/cancel`: `{}`. Cancellation is terminal for this case.

There is no client-supplied thread, owner, executor, model credential, replacement permission set or auto-promotion flag.

## Local verification boundary

Deterministic PostgreSQL tests exercise reviewed source conversion, exact approval, rejected/changed/stale/expired reviews, cancellation, incompatible graph identity, crash after draft commit, bounded repeated retests, baseline preservation, real state-effect evidence, workspace budget exhaustion and promotion through the existing gate. Component rendering checks cover escaped proposal text, availability labels and the distinction between applied and verified. These checks use synthetic records/drivers and incur no live model cost. Final local checks passed: 124 unit tests, all 93 offline PostgreSQL integration tests across 25 files, type checking and lint. Six focused repair/runtime checks also passed after the final tracing and recovery changes. The standard Turbopack production build was attempted and failed because this execution environment denies its CSS worker a local port bind. No alternate bundler, live model call, hosted execution, interactive browser verification or successful production build is claimed.
