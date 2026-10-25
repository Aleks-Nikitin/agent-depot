# Agent Depot / AgentForge

Next.js agent platform with Prisma ORM and PostgreSQL. The [Application integration guide](docs/integration-README.md) covers the connected builder, tools, live playground, tests, publishing, versions and dashboard. Read the [Agent Runtime Engine documentation](docs/runtime-README.md) for implementation details, integration interfaces, API examples, verification, and design decisions.

See [Authentication and personal workspaces](docs/auth-README.md) for Better Auth email/password, GitHub OAuth, isolated guest access, required environment settings and migrations. The promotion, new-agent form and tools catalog are public. Saving, Gemini drafting, execution and private workspace data require a session; protected builder actions open login/signup without losing the form. Set a unique local `BETTER_AUTH_SECRET` before using the app; the example intentionally contains no secret. Stripe is not implemented in this auth milestone.

## Start locally

Requirements: Node.js 22.12+ (Node 24 recommended), npm, Docker Desktop with Compose. Install Docker Desktop from [Docker's official instructions](https://docs.docker.com/desktop/) if absent, and start it before running database commands. Docker Desktop is already installed on the original development machine.

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:generate
npm run db:deploy
npm run db:check
npm run db:seed-demo
npm run dev
```

Open [localhost:3000](http://localhost:3000). The Compose project `agent-depot` runs PostgreSQL 16 at **localhost:55433**, bound only to loopback, with persistent volume `postgres_data`. Change the example password and matching `DATABASE_URL` before using another environment. If port 55433 is occupied, change both `POSTGRES_PORT` and `DATABASE_URL`.

**PostgreSQL is the running database server. Prisma is an ORM/client and CLI, not another server instance.** Generate the client, apply migrations, then use Prisma Studio to inspect records if desired.

## Database operations

```bash
npm run db:up         # Start PostgreSQL and wait for health check
npm run db:status     # Container status
npm run db:generate   # Generate Prisma TypeScript client
npm run db:deploy     # Apply committed migrations
npm run db:migrate -- --name describe_change  # Create/apply a development migration
npm run db:studio     # Inspect records using Prisma Studio
npm run db:check      # Prisma transaction smoke check; cleans up only its own test record
npm run db:seed-demo  # Add support-demo/sales-demo without replacing existing agents
npm run db:down       # Stop containers, preserving data
```

Maintain one coordinated migration history for `prisma/schema.prisma`. Commit schema and migration changes together. After pulling schema changes, run `db:generate` and `db:deploy`. The generated client and real `.env` stay out of Git.

Do not delete the Compose volume unless you intend to erase local data. PostgreSQL initialization settings only apply to a new volume: changing `.env` does not rotate an existing database password.

## Shared storage assumptions

- `Agent`: owner-scoped saved agent configuration.
- `AgentRun`: immutable configuration snapshot, status, version, private checkpoint, final answer.
- `RunEvent`: durable ordered events; unique event ID and run/sequence pair for history and monitoring.
- `Approval`: exact stored tool arguments, expiry, and one recorded decision.
- `DemoTicket`: an immediate internal support ticket with a unique idempotency key.

Run snapshots retain history independently of agent deletion/edits. Checkpoints remain server-only. The runtime storage adapter implements atomic pause/claim/finish operations against this schema.

## Configuration and verification

Use `.env.example` as the template. Never expose database or model credentials through `NEXT_PUBLIC_*`. Runtime execution requires the credentials/model/pricing configuration in the linked Runtime README.

`DATABASE_TARGET=local` (default) uses `DATABASE_URL`. Set `DATABASE_TARGET=tiger` to use the server-only `TIGER_DATABASE_URL` for both Prisma commands and the application. Keep both URLs in your ignored environment and restart after changing the target. Selecting another database does not migrate existing records between databases.

```bash
npm run typecheck
npm run lint
npm run build
```

`npm test` runs deterministic contract, registry, transport, and drafting unit tests. `npm run test:integration` runs the PostgreSQL-backed store, runtime, approval and idempotency tests and deletes only test-created records. Database checks require the container to be healthy. Prisma schema/config follow the installed Prisma 7 conventions, including the PostgreSQL driver adapter.

## Runtime integration

Optional Tiger Data time-series analytics use the same PostgreSQL/Prisma stack. See [runtime metrics setup and query contracts](docs/runtime-metrics.md) for the default PostgreSQL path, TimescaleDB setup and isolated tests.

`GET /api/runtime/metrics` provides session-authenticated hourly outcomes, duration, model/tool usage, token and estimated-cost aggregates. It requires bounded UTC `from`/`to` query parameters; an optional `agentId` filters the report. The linked metrics documentation describes the API, local-only legacy bearer option and temporary Tiger certificate compatibility setting. The local PostgreSQL path is verified; hosted Tiger write/read verification remains blocked before TLS.

See the [Agent Runtime Engine documentation](docs/runtime-README.md) for execution, persistence, approvals, tool registration, streaming, and evaluation interfaces.

The builder, six integration tools, live playground/approvals, saved history, Evaluation Lab, Versions and Tools & Knowledge screens are connected to the owner-scoped backend. Publishing requires current server-side passing test evidence. Starter templates include three checks; the builder requests tests after save/restore when cases exist. See the integration guide for limits and verification. Hosted Tiger Cloud metric writes/reads remain unverified because external connections time out before TLS.

`npm run typecheck` regenerates Next.js route types before checking TypeScript, so new pages/layouts pulled from teammates are included without running a full build first.

`npm run dev` and `npm run build` retain Next.js's default **Turbopack**. Restart the dev server after regenerating Prisma. If a previously malformed package file causes a stale build error, stop the server and clear/preserve its generated `.next` cache before restarting.

See [Guarded actions](docs/guarded-actions.md) for immediate support tickets, connected-tool requirements and actionable failure explanations. Email delivery and messaging integrations are not supported; evaluations always deny writes.

For live competitor prices, news and webpage reading, set `SERPAPI_API_KEY` in the local `.env` and save it. Gemini still handles reasoning. Tools & knowledge shows connection setup; selecting a tool per agent controls its availability. Search results may include different package sizes and sellers, so compare equivalent units before treating a lower listed price as a better deal.
