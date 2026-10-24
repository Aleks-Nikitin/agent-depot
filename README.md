# Agent Depot / AgentForge

Next.js agent platform with Prisma ORM and PostgreSQL. The Developer 2 implementation specification is in `docs/developer-2-runtime-plan.md` (local backbone, currently ignored by Git).

## Start locally

Requirements: Node.js 22.12+ (Node 24 recommended), npm, Docker Desktop with Compose. Install Docker Desktop from [Docker's official instructions](https://docs.docker.com/desktop/) if absent, and start it before running database commands. Docker Desktop is already installed on the original development machine.

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:generate
npm run db:deploy
npm run db:check
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
npm run db:down       # Stop containers, preserving data
```

One developer owns `prisma/schema.prisma` and migrations. Commit schema and migration changes together. After pulling schema changes, run `db:generate` and `db:deploy`. The generated client and real `.env` stay out of Git.

Do not delete the Compose volume unless you intend to erase local data. PostgreSQL initialization settings only apply to a new volume: changing `.env` does not rotate an existing database password.

## Shared storage assumptions

- `Agent`: owner-scoped configuration for Developer 1.
- `AgentRun`: immutable configuration snapshot, status, version, private checkpoint, final answer.
- `RunEvent`: durable ordered events; unique event ID and run/sequence pair for Developer 3.
- `Approval`: exact stored tool arguments, expiry, and one recorded decision.
- `DemoTicket`: a local write with a unique idempotency key for approval demonstrations.

Run snapshots retain history independently of agent deletion/edits. Checkpoints remain server-only. The runtime storage adapter will implement atomic pause/claim/finish operations against this schema; schema creation alone does not implement the adapter.

## Configuration and verification

Use `.env.example` as the template. Never expose database or model credentials through `NEXT_PUBLIC_*`. Runtime credentials/model/pricing fields are reserved for the next runtime milestones.

```bash
npm run typecheck
npm run lint
npm run build
```

`npm test` runs the runtime tests once those are added. Database checks require the container to be healthy. Prisma schema/config follow the installed Prisma 7 conventions, including the PostgreSQL driver adapter.
