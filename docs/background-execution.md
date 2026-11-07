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
