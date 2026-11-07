# Background execution

Agent runs, approval continuations and evaluation suites execute in a standalone Node process using Graphile Worker 0.18. Queue tables live in the vendor-owned `graphile_worker` PostgreSQL schema, alongside the separate `langgraph_checkpoints` schema and Prisma-managed application tables. The same selected application database is used; no Redis, extra database server or paid infrastructure is required.

## Setup

After installing dependencies, verify the selected database, then run:

```sh
npm run db:generate
DATABASE_TARGET=local npm run db:deploy
npm run runtime:setup
npm run worker:setup
npm run worker
```

Run the web application separately. Both processes must use the same database target, model/pricing configuration and secrets. `DATABASE_TARGET` retains its existing `local`/`tiger` meanings. Application startup never installs the vendor queue schema. The worker also lets Graphile apply its own version checks/migrations during startup. Migration permissions are required for setup/startup; a hosted least-privilege deployment remains separate work. Do not run integration tests against hosted data.

The worker polls with concurrency two. Graphile handles delivery locks and shutdown signals; active work observes the worker abort signal and the existing runtime deadlines. The entrypoint closes the queue, application and checkpoint pools on exit. Logs use generic lifecycle/error summaries, excluding connection strings, job payloads and provider bodies.

## Receipts and local effects

`ExecutionJob` is an owned application receipt, separate from disposable vendor jobs. A transaction creates the pinned run or suite, its receipt, the conversation claim or approval decision, and the vendor queue entry together. Queue payloads contain only the receipt UUID. The private application payload holds evaluation snapshots or approval references and never appears in the public job view. Owner-scoped request keys and normalized request hashes reject conflicting reuse and return the same receipt for retries, including completed jobs. No second vendor job is added for an existing receipt; vendor job-key replacement is not relied on for application idempotency. See [Graphile job-key caveats](https://worker.graphile.org/docs/job-key).

Runs pin their config/provider metadata before enqueue, and conversations claim their active turn in that same transaction. Evaluations pin config, cases, knowledge and immutable manifests before enqueue. Waiting suites block another suite for the same agent even if queue delay exceeds the old synchronous stale-run cutoff. Changes in current tool/policy identity before worker execution fail closed; later changes in draft/tests/dependencies still invalidate promotion evidence.

`LocalOperation` stores the owner, trusted tool identity, normalized input hash and result. Receipt and ticket creation commit in one PostgreSQL transaction. The key retains the runtime's run/call identity. Identical concurrent invocations return the retained result; changed owner/arguments fail. Existing ticket idempotency keys remain compatible. Disposable evaluation scopes have their own transactionally committed receipts and serialize writes on their single connection. Their receipts are removed with fixture cleanup. These guarantees cover the supported internal ticket action; they do not implement exactly-once remote effects or business deduplication across different run/call identities.

## Interrupted workers

Delivery retries do not blindly restart agent loops or billable calls. A completed/paused run is recognized after a crash before acknowledgement. Completed suite evidence is recovered from its persisted record. If a prior worker entered execution but did not record a terminal result, redelivery marks that run/suite failed with `worker_interrupted`, preserving committed local effects and conservative model reservations. It does not rerun cases, replay writes or invent an answer. Retry by creating a new explicit request after reviewing the trace. Graphile controls when stale delivery locks are released; immediate crash recovery is not promised. A hard-killed evaluation can leave disposable schemas until the existing `eval:cleanup` expiry maintenance runs.

Graceful cancellation is cooperative. A committed local effect is retained even if cancellation arrives immediately afterward, and a started provider request may still be billed. Model recovery remains owned by runtime middleware; queue retries do not add another provider retry loop.

## Endpoints and reconnects

The run, serving execution, conversation-message, approval-decision and evaluation-run POST endpoints now return HTTP **202** JSON receipts: `{ jobId, kind, status, runId, testRunId }`. They no longer execute a model loop within the HTTP request. Run/evaluation/message submissions require an `Idempotency-Key` header (1–128 letters, digits, underscores, dots or hyphens). Approval ID plus decision identifies approval retries; changed decisions conflict. Existing direct server `runAgent`/`resumeAgent` contracts remain available to trusted internal callers and tests.

- `GET /api/runs/:id/events?after=N` streams persisted NDJSON events with sequence greater than N. It checks ownership before sending headers, polls saved events, and closes after a terminal/pause state or 25 seconds. The browser reconnects at its last delivered sequence, de-duplicates events, and never POSTs a second execution to reconnect. Existing `GET /api/runs/:id?after=N` remains a snapshot/cursor API.
- `GET /api/jobs/:id` returns only the owned receipt, cancellation flag, safe reason and retained result. Private payload/config/checkpoint objects are excluded. A `completed` job means its execution settled; inspect the run status or evaluation case outcomes for success.
- `POST /api/jobs/:id/cancel` with `{}` requests cooperative cancellation for a queued/running job. `POST /api/runs/:id/cancel` resolves the owned active job for a run. Cancellation does not grant authorization to reverse completed effects or decide a paused approval. A pause is handled through its existing approval decision.

The playground records the accepted run ID before the first worker event, retains its conversation/run URL, reconnects on reload and offers **Stop run**. A paused approval reconnects to the same run after its decision is queued. The Evaluation Lab polls the accepted job and rediscovers a queued/running suite on reload, with **Stop evaluation** available. Closing either viewer cancels its network reads only. Run and suite deadlines begin when execution starts, rather than expiring while waiting in the queue. If receipt delivery is uncertain, reuse the original idempotency key; a new key means a new requested action. Direct one-shot API consumers must retain the returned run/job IDs; the playground handles this through its conversation URL.

The ticket tool revision is now `domain-tools-v2-local-receipts`, so old certification evidence for that tool requires fresh evaluation before a new promotion. This does not rewrite previously approved release artifacts.

## Verification boundaries

Three new local PostgreSQL integration tests exercise actual Graphile delivery, duplicate requests and changed-input rejection, conversation claims, single-use approval continuations, atomic local receipt replay, cursor reconnect after viewer cancellation, queued/active cancellation, conservative interrupted-worker settlement and queued evaluation publication evidence. Explicit deterministic test drivers avoid live provider calls. A separate transport check drops a viewer stream and verifies that the browser reconnects at the last delivered sequence without another submission.

The standalone entrypoint was smoke-started against local PostgreSQL and stopped. Type checking, lint, 121 unit checks and 19 focused PostgreSQL runtime/release/evaluation checks passed. The production build was attempted with Turbopack and remains blocked by the execution environment denying its CSS worker a local port bind. No full browser end-to-end, hosted queue, live-provider, deployment or automatic continuation of hard-killed in-flight model calls is claimed.
