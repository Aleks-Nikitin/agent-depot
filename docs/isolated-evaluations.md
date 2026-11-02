# Isolated evaluation state

Evaluation suites now execute supported domain actions against disposable fixture data. A ticket created during a test is a real database write in that test environment; it does not create a workspace ticket. The same trusted tool adapters handle serving, Playground and evaluation calls through an injected owner-scoped repository.

## Setup

Use the existing PostgreSQL instance. Application tables, execution evidence and graph checkpoints remain in the application database. Fixtures use a separate logical database named exactly `agentdepot_eval`.

```sh
npm run db:generate
DATABASE_TARGET=local npm run db:deploy
npm run runtime:setup
npm run eval:setup -- --local
```

With no `EVAL_DATABASE_URL` configured, `--local` can provision the evaluation database and a dedicated restricted login on a loopback PostgreSQL server. It generates a password and appends the connection to the ignored local `.env` file without printing it. It does not change Git ignores. Existing role/configuration conflicts require operator review; the script does not rotate existing credentials. Restart the application after environment changes. Keep CLI `.env` values and any Next.js `.env.local` overrides consistent.

For hosted use, an operator must provision the logical database and role on the same approved PostgreSQL instance and configure `EVAL_DATABASE_URL` privately. Running `eval:setup` with that configuration installs only the tracked evaluation control schema. The script does not provision hosted infrastructure. Apply [application migrations](../prisma/schema.prisma) first; the new owner-scoped `WorkspaceOrder` table is part of the live domain model. Evaluation control DDL lives separately in `prisma/evaluation/001_environment.sql`, outside application and LangGraph migrations.

The evaluation connection must use a different login from the application connection. It needs CONNECT and CREATE on the evaluation database, with no superuser, bypass-RLS, role/database-creation privilege or role memberships. It must have no INSERT/UPDATE/DELETE privileges on the application's ticket, knowledge or order tables. The adapter verifies those permissions, the actual connected database/role, and the PostgreSQL instance identity before seeding. A live database URL, another server, privileged role, missing configuration or failed verification stops evaluation. There is no fallback to live domain data. `DATABASE_TARGET` remains the existing `local`/`tiger` selector; it does not select the fixture database.

## Scoped tools and fixture lifecycle

`ToolContext.domain` exposes narrow operations for knowledge, sample products, order lookup and idempotent ticket creation. It exposes no SQL, credentials, arbitrary client or caller-selected owner. Domain tools require this context; missing or mismatched ownership fails before invocation. Normal runs receive a repository bound to their authenticated owner.

`order_lookup` is a read-only tool over owned `WorkspaceOrder` records. Missing orders return `null`; there is no external commerce connector or automatic live-order seed. Existing ticket behavior remains immediate, bounded and deduplicated by run/call identity.

At suite start, the server captures up to 100 owned knowledge documents. With no uploads it captures the labeled sample policies. Documents from another owner are not copied, and samples are not mixed into an uploaded collection. All cases in the suite use this same content snapshot, even if live documents change later.

Each case receives a new, server-generated schema in `agentdepot_eval`, seeded transactionally with:

- An empty ticket collection.
- An illustrative delivered order `1042`, totaling 4,900 cents in USD.
- The captured knowledge snapshot and the labeled sample product catalog.

The internal fixture adapter also supports explicit bounded ticket/order/product seeds. These are server-side contracts; configurable case fixture editing and deterministic mutation assertions are not introduced here. Fixtures are limited to 2 MB. Each repository is bound to its owner and attempt ID, and ticket writes retain database-level conflict arbitration.

Only registered isolated repositories can authorize evaluation domain writes. Other write tools remain denied. External search/news/webpage calls are unavailable during isolated evaluation; they cannot silently retrieve live data. Existing explicit `approvalMode: "deny"` callers retain their deny-writes behavior. Normal serving and Playground tool policy is unchanged.

Run checkpoints bind the attempt ID and knowledge hash, and evaluation runs retain `source: "test"`. Runtime events, metrics, suite results and configuration snapshots are still persisted in the application database as evidence. Private fixture connections and checkpoint state are not returned to the browser. The repository capability is revoked during teardown: a saved evaluation cursor cannot resume against a live repository or a closed fixture environment.

Cleanup runs in `finally` after success, provider failure, cancellation or grading failure. The schema and its control row are removed and the connection closes. Cleanup failure makes the case an error, not a pass. A process crash or database outage can leave an abandoned schema. Registered scopes expire after one hour; operators can remove only expired scopes with:

```sh
npm run eval:cleanup
```

No automatic cleanup scheduler is installed. Live tables, database volumes and active unexpired scopes are not reset by this command. Evaluation connections use bounded connection and statement timeouts.

## Verification and limits

Deterministic local PostgreSQL checks exercise owner-scoped live access, production-target rejection, independent concurrent fixture state, knowledge snapshots, idempotent fixture ticket writes, unchanged live ticket counts, successful/failed/cancelled suite teardown, expired-scope cleanup, and rejection of a closed evaluation cursor on resume. Existing runtime and release checks remain applicable. No live model call, hosted write/read or deployment verification is implied.

Current case assertions still check answer text and attempted tools. Executing an isolated action is not yet a deterministic assertion that its fields or final business state are correct. Before/after mutation assertions and their release evidence manifests remain separate work. This is an application tool/data boundary, not a sandbox for arbitrary hostile code.

Local verification for this change: typecheck, lint, 119 unit tests and 18 focused PostgreSQL integration checks passed. The Turbopack production build remains blocked by the execution environment denying the CSS worker a local port bind; no bundler workaround or hosted verification is claimed.
