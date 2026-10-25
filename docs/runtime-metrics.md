# Runtime metrics and optional Tiger Data

The runtime writes one terminal `RuntimeMetric` row atomically with the run status and event. PostgreSQL remains the default. Tiger Cloud can host the same Prisma PostgreSQL database; enabling TimescaleDB turns this table into a hypertable and adds an hourly continuous aggregate. The runtime does not call an extra analytics service while running an agent.

## Ordinary PostgreSQL

```bash
npm run db:generate
npm run db:deploy
npm run test:integration
```

New completed, failed and blocked runs produce metrics. Active/approval-waiting runs do not; older finished runs are not backfilled. `activeMs` excludes approval waiting and includes active event delivery. It is not wall-clock latency. Rows contain owner/agent/version/model profile, outcome/reason, finish time, active duration, model/tool counts and nullable token/cost estimates. Prompts, answers, instructions, tool inputs/results and checkpoints are excluded. Identifiers and operational metadata still require owner authorization. There is no automatic retention, compression or export.

## Enable Tiger Cloud / TimescaleDB

Tiger Data accepts PostgreSQL clients; the existing Prisma adapter needs no new SDK. [Connection documentation](https://www.tigerdata.com/docs/integrate/find-connection-details)

1. Create a Tiger Cloud service in your account. Set `TIGER_DATABASE_URL` locally/on the server using its connection details and verified TLS (`sslmode=verify-full` with its public CA chain). Keep `DATABASE_URL` for the local database and set `DATABASE_TARGET=tiger` to select Tiger Cloud for the entire app, Prisma CLI and metrics. The default `local` target uses `DATABASE_URL`; a missing Tiger URL never falls back silently. Keep both URLs server-only, outside chat and Git. Restart the app after changing the target. Switching databases does not copy existing data.
2. Run `npm run db:generate` and `npm run db:deploy` against that database.
3. During setup/maintenance, run `npm run metrics:setup`. It needs permission to use/create the extension, convert the table and create aggregates/jobs. Conversion takes table locks. The script uses a transaction/advisory lock and can be rerun for the same definition; future definition changes require explicit migrations.
4. Set `RUNTIME_METRICS_BACKEND=timescale` and restart the application. Leave `postgres` for ordinary PostgreSQL or raw-table queries. Missing Timescale setup produces an error, not a silent fallback.
5. Run real agents, then `npm run metrics:check`. It reads the demo workspace's current UTC hour without printing run contents/credentials, and compares Timescale real-time metrics with raw data in a consistent database snapshot. Zero runs verifies the query path, not metric ingestion; run an agent first to demonstrate ingestion. Retain evidence from the actual Tiger Cloud deployment before claiming sponsor service use. Local TimescaleDB tests establish extension compatibility, not use of hosted Tiger Cloud.

`sql/runtime-metrics-timescale.sql` creates the hypertable and `runtime_metrics_hourly`. The compound primary key includes the partition timestamp. The view groups by UTC hour, owner and agent; real-time aggregation includes recent writes before refresh. A five-minute policy refreshes completed historical buckets while leaving the latest hour live. Historical invalidations have no retention cutoff; no raw metrics are dropped. [Hypertable API](https://www.tigerdata.com/docs/reference/timescaledb/hypertables/create_hypertable), [continuous aggregate setup](https://www.tigerdata.com/docs/build/continuous-aggregates/create-a-continuous-aggregate)

Historical updates/deletes, including run deletion cascading to metrics, can remain visible in materialized buckets until refresh. Operators can call `refresh_continuous_aggregate` for affected completed UTC hours to apply corrections immediately. Raw queries through `postgres` mode reflect committed data immediately. [Real-time aggregate behavior](https://www.tigerdata.com/docs/learn/continuous-aggregates/real-time-aggregates)

Prisma migrations own the relational schema; optional Timescale SQL owns its hypertable/aggregate/policy. Avoid `prisma db push` or destructive migration changes against extension-owned internal schemas. Coordinate intentional future SQL/schema changes.

### Connection troubleshooting

```bash
DATABASE_TARGET=tiger npm run db:diagnose
```

This credential-free probe reports DNS resolution, TCP connection, PostgreSQL SSL negotiation and verified TLS separately. It never authenticates or prints database URLs/addresses/passwords. A TCP timeout happens before certificate validation; disabling certificate checks cannot fix it. Check service readiness, the current Connect URL, public/VPC networking, attached IP allow lists and outbound network restrictions. Try the same command in your terminal or on another permitted network to locate a network-specific block. If an allow list is attached, it must include the connecting machine's public egress IPv4/CIDR. The existence of the settings section alone does not mean a list is attached. [Tiger security documentation](https://www.tigerdata.com/docs/deploy/tiger-cloud/tiger-cloud-aws/security/ip-allow-list)

The diagnostic always verifies certificates and hostname using Node's trusted CAs. A certificate failure is reported at `tls_verification`, not `tcp`; investigate the trust chain rather than setting `rejectUnauthorized: false`. Local loopback Docker PostgreSQL may report `server_tls_unavailable`, since its development-only service does not enable TLS. A successful probe establishes reachability/TLS, not credential validity or migration permissions.

The initial configuration record identifies the selected target/source variable, presence of username/password/database/port, whether the endpoint is local, and normalized SSL/compatibility settings. It contains no actual endpoint, database, user or secret values. Missing credentials are reported but do not prevent the credential-free network probe; authentication is a separate check.

### Hosted investigation status

- **Configuration:** explicit Tiger selection uses `TIGER_DATABASE_URL`. Endpoint/database/user match the downloaded service credentials; Node parsing agrees and no environment override was found. A missing `.env` password was restored privately. Authentication remains untested.
- **Connectivity:** Node and macOS `psql` (`require`/`verify-full`) time out before TLS, as does Docker Linux `psql`. The HeavyFuel control also times out. Six IPv4 addresses resolve, no IPv6 records exist, and all explicit IPv4 probes time out. No configured proxy or connected VPN was found; this is not a comprehensive firewall exclusion.
- **TLS:** the HeavyFuel compatibility option would change certificate verification; it was not applied. No global TLS override was enabled. [Driver SSL behavior](https://node-postgres.com/features/ssl)
- **Verification:** owner-reported Console `SELECT 1` confirms internal SQL only. Hosted application authentication, migrations, hypertable/aggregate setup and metric write/read remain **unverified**. This branch/main have a query helper, but no monitoring HTTP route; no hosted API success is claimed.
- **Scope:** only this Mac is available. Docker shares its egress; hotspot tests used the same device. No independent external client can distinguish device/network restrictions from service-side reachability. Resume after endpoint/network changes or an independent probe.
- **Fallback:** `DATABASE_TARGET=local` remains selected; normal execution makes no Tiger calls. Selecting `tiger` moves the whole application database—it is not an independent optional analytics sink or automatic failover. No runtime architecture was changed to bypass the network blocker; separate hosted export/monitoring remains post-connect work.

## Monitoring server integration

Call the helper after resolving the authorized session/workspace owner. The helper does not authenticate callers; never pass an arbitrary browser-provided owner ID.

```ts
import { getDb } from "@/lib/db/prisma";
import { queryRuntimeMetrics } from "@/lib/agents/storage/metrics";

const to = new Date((Math.floor(Date.now() / 3_600_000) + 1) * 3_600_000);
const from = new Date(to.getTime() - 24 * 3_600_000);
const report = await queryRuntimeMetrics(getDb(), {
  ownerId: authorizedOwnerId, from, to, agentId: optionalAgentId,
});
```

The window is inclusive `from`, exclusive `to`, with exact UTC hour boundaries spanning 1 hour to 31 days. Owner/agent/time values use bound parameters. Results include `backend`, ISO window boundaries and ordered nonempty hourly `buckets`. The UI can fill missing buckets with zero activity. The next hour boundary includes the current hour.

Each bucket contains `runs`, `completed`, `failed`, `blocked`, `activeMsTotal`, `averageActiveMs`, `modelCalls`, `toolCalls`, `knownInputTokens`, `knownOutputTokens`, `knownEstimatedCostUsd` and `unknownUsageRuns`. Known totals sum available components; show the unknown count beside cost/token totals. Estimated cost is not a provider invoice or infrastructure bill. Combine hours using total duration/count, not an average of averages. Success rates count terminal runs in the finish-time window and exclude active/waiting runs and pre-migration history.

The monitoring branch owns its authenticated HTTP endpoint, charts, date filters and presentation. This branch provides the query contract and atomic persistence.

`npm run runtime:smoke -- --live` also verifies each live run produces exactly one terminal metric with matching estimated cost and appears in the selected hourly analytics backend. Approval pauses must produce no terminal metric. Its cleanup removes its own runs/tickets and cascaded metrics after checking them; a later report may therefore contain zero smoke runs.

The expanded live check passed on October 24, 2026 with the PostgreSQL backend (five Gemini checks plus terminal-row/hourly-ingestion assertions; estimated model cost $0.001267). The connection diagnostic separately distinguished reachable local PostgreSQL without TLS from a TCP timeout on the configured Tiger Cloud endpoint. Hosted setup/ingestion is not yet verified; local TimescaleDB extension tests passed independently.

## Isolated TimescaleDB tests

The optional test service has a separate database/volume on loopback port 55434. It uses local `POSTGRES_PASSWORD` and optional `TIMESCALE_TEST_PORT`.

```bash
npm run metrics:test:up
npm run test:timescale
npm run metrics:test:down
```

The command forces the local target and constructs a connection only to the isolated local database, ignoring both configured application database URLs/target. It applies migrations, runs setup twice, then executes all database integration tests plus extension-specific tests. These cover hypertable creation, fresh rows, manually materialized history, tenant/agent filters, unknown usage and parity with raw PostgreSQL. Cleanup deletes only test-created records. Stopping the container preserves its volume.

Verified locally on October 24, 2026: 36 unit tests, 34 ordinary PostgreSQL integration tests and 35 TimescaleDB integration tests passed, plus TypeScript/lint and production compilation using the documented one-off webpack fallback. Five live Gemini checks passed with atomic metrics enabled (aggregate estimated model cost $0.001256). The TimescaleDB PostgreSQL 16 test image is pinned by digest. Hosted Tiger Cloud activation is a separate check; the default Turbopack scripts remain unchanged.

## Other sponsor fits and ownership

- **Snowflake — integrations branch, Developer 4:** Cortex Search can back a read-only `knowledge_search` tool through `ToolDefinition`. Own corpus ingestion/service setup, bounded REST queries, result normalization and fixtures. Use server-configured identifiers/credentials, cancellation, bounded results and the runtime allowlist. This needs a real corpus/service; no second model provider is necessary while Gemini meets runtime needs. No Snowflake implementation or live verification is claimed here. [Cortex Search API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service)
- **Vultr — shared deployment, project lead/Developer 1:** Cloud Compute can host the Next server with Tiger Cloud as database. Coordinate secrets, migrations and NDJSON streaming/cancellation. Kubernetes/GPUs add no demonstrated value for this Gemini-backed workload. No Vultr resources are provisioned or deployment success claimed. [Vultr Next.js guide](https://docs.vultr.com/how-to-deploy-a-next-js-application-with-vultr-kubernetes-engine-and-vultr-load-balancer)
- **Gemini** already powers execution/drafting. **Solana** is excluded. **Cursor/Grok raffle** is a team workflow/submission decision; describe only tools actually used. No raffle automation belongs in the runtime.
