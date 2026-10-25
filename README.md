# Agent Depot / AgentForge

Next.js agent platform with Prisma ORM and PostgreSQL. Read the [Agent Runtime Engine documentation](docs/runtime-README.md) for implementation details, integration interfaces, API examples, verification, and design decisions.

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
- `DemoTicket`: a local write with a unique idempotency key for approval demonstrations.

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

See the [Agent Runtime Engine documentation](docs/runtime-README.md) for execution, persistence, approvals, tool registration, streaming, and evaluation interfaces.

The runtime engine is implemented and verified locally. The merged playground, run-history and tests screens still use fixtures; live browser authentication and backend wiring remain integration work. The runtime documentation tracks the current checks and remaining integration gates. Hosted Tiger Cloud metric writes/reads remain unverified because external connections time out before TLS.

`npm run typecheck` regenerates Next.js route types before checking TypeScript, so new pages/layouts pulled from teammates are included without running a full build first.

`npm run dev` and `npm run build` retain Next.js's default **Turbopack**. This environment's Turbopack CSS worker currently cannot bind its internal port; the recorded webpack command is a verification fallback only, not a change to the project's stack or scripts.
