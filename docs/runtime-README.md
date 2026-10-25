# Agent Runtime Engine

Implementation documentation for the agent runtime engine: execution flow, tool registration, persistence, approvals, streaming APIs, configuration, design decisions, and verification.

See [Runtime metrics](runtime-metrics.md) for optional Tiger Data setup, monitoring query contracts and sponsor integration ownership.

## Current implementation status

The core runtime feature is implemented: configuration loading, trusted tool registration, bounded multi-step execution, durable events, approval pause/resume, reusable evaluation execution with writes denied, and validated agent drafting. Two distinct configurations and approved/rejected writes have passed real Gemini smoke checks. Terminal metrics persist atomically on PostgreSQL; optional hypertables and hourly aggregates passed isolated TimescaleDB tests.

Main's playground UI and runtime diagnostics merges are integrated through `e1c3088`. The playground is still in `CLIENT_MODE = "mock"`, run history reads fixtures, and the tests screen uses fixtures. Merging these screens does not establish a live browser-to-runtime flow. See [playground integration gaps](playground-placeholders.md) for their implementation backlog.

Three integration gates remain outside the completed core engine:

1. **Playground and evaluations:** wire authenticated browser requests to execution/approval, replace history fixtures with owner-scoped reads, and connect the test runner. Runtime interfaces are available below; session ownership and the UI's backend phase need coordinated integration.
2. **Optional hosted Tiger verification:** establish external connectivity, apply setup, and prove an application-originated metric write/read and monitoring read. The HeavyFuel URL-specific SSL compatibility option was applied on request, but both strict TCP diagnostics and the actual `pg` client still time out before TLS. Local TimescaleDB success is not hosted verification. The existing Tiger selector changes the entire primary database; an independently optional analytics destination would require a separate export design and is not implemented.
3. **Deployment:** verify the deployed authentication boundary, streaming, approval/resume and database migrations. Local compilation and tests do not establish deployment success.

The analytics endpoint follow-up passed **68 unit tests, 37 PostgreSQL integration tests, typecheck, lint and production compilation** using the documented one-off webpack fallback. The earlier isolated TimescaleDB suite passed **35 integration tests**; its SQL/setup has not changed. The latest live Gemini run passed five checks, including terminal metric/hourly-ingestion assertions on local PostgreSQL (aggregate estimated model cost $0.001267); UI fixtures are not included in that live claim.

The runtime now exposes authenticated hourly analytics through `GET /api/runtime/metrics`. It returns owner-scoped outcome, active-duration, model/tool, token and estimated-cost aggregates from PostgreSQL or the configured Timescale view. See the metrics document for query parameters and authentication. This fills the analytics HTTP read boundary; it does not switch the fixture-backed dashboard to live data.

`npm run typecheck` now runs `next typegen` before `tsc --noEmit`. This refreshes generated `PageProps`/`LayoutProps` route definitions after pulling new pages/layouts, without requiring a production build. No dependency or bundler change is involved.

## Overview

One backend engine runs saved agents with different instructions and tools. It loads owner-scoped configuration, exposes only permitted tools, validates arguments, executes bounded model/tool rounds, streams durable events, pauses writes for human approval, and resumes with the same state. Evaluations reuse the engine with writes automatically denied. An additional endpoint generates editable agent drafts with tool reasons, assumptions and suggested tests.

The included integrations use clearly labeled demo policy and sales datasets and a real local database ticket write. External integrations use the same tool interface. The agent builder supplies saved configurations, and the playground consumes execution events.

## Stack and quick start

Next.js 16 / React 19, TypeScript, Prisma 7 with `@prisma/adapter-pg`, PostgreSQL 16, Docker Compose, AI SDK 7 with `@ai-sdk/google`, Zod, and Vitest. There is no separate Python service, queue framework, or additional runtime language. Turbopack remains the default bundler.

Follow the root README's database setup first:

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:generate
npm run db:deploy
npm run db:check
npm run db:seed-demo
```

Skip the copy step if you already have `.env`. The seed adds `support-demo` and `sales-demo` without replacing existing records. Edit an existing agent through the builder or database if its configuration needs updating; rerunning the seed deliberately does not overwrite it.

Prisma is an ORM/client and migration CLI; PostgreSQL is the database server running in Docker. The loopback endpoint is `localhost:55433`, with persistent Compose volume `postgres_data`. Share committed migrations, not generated Prisma files or local credentials. Maintain one coordinated schema and migration history.

## Environment configuration

All settings are server-side; never prefix them with `NEXT_PUBLIC_`.

- `DATABASE_URL`: PostgreSQL connection string, matching the Compose port and password.
- `DATABASE_TARGET`: `local` by default, or `tiger` to select `TIGER_DATABASE_URL` consistently for the app and Prisma CLI. Keep the local URL available and restart when switching. No implicit fallback or cross-database copying occurs.
- `TIGER_DATABASE_URL`: optional server-only Tiger Cloud connection. Set it locally/deployed; never commit or log it.
- `GOOGLE_GENERATIVE_AI_API_KEY`: real Google API key, stored only in the local/deployment environment.
- `RUNTIME_API_TOKEN`: random secret of at least 24 characters. Empty/short values disable endpoints. This initial adapter authorizes one workspace (`demo`); it is not a multi-user login implementation.
- `RUNTIME_MODEL_ID`: exact provider model ID. The selected default is `gemini-3.1-flash-lite`. The adapter also retains profiles for `gemini-2.5-flash` and `gemini-2.5-flash-lite`; availability is a provider/account prerequisite, not established by mocked tests.
- `RUNTIME_INPUT_USD_PER_MILLION` / `RUNTIME_OUTPUT_USD_PER_MILLION`: conservative standard-text rates for the selected model. The example uses 0.25 / 1.50 for Gemini 3.1 Flash-Lite, verified October 24, 2026. Recheck rates when changing models, service tiers or input modalities. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite).

Gemini 3.1 Flash-Lite supports function calling and structured output. Its adapter uses `thinkingLevel: minimal` and suppresses thought summaries; minimal is not a guarantee of zero reasoning. The older 2.5 profiles request `thinkingBudget: 0`. Output usage includes reasoning tokens, and that total contributes to estimated cost. [Model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [Gemini 3 thinking settings](https://ai.google.dev/gemini-api/docs/gemini-3#thinking_level).

The server-selected model, rates and execution-profile version form a fingerprint stored in the checkpoint. Changing them while a run waits causes a policy stop on resume instead of silently changing its accounting/execution rules.

## Execution flow and critical decisions

For example, a support agent receives “Can I return this after 20 days?” The engine loads its saved instructions and permitted tools, asks Gemini what to do, validates a `knowledge_search` call, runs it, and gives the result back to Gemini for the final answer. A sales agent follows the same loop with `sales_lookup` enabled instead. Each stage saves an ordered event that the playground can show later.

If the agent requests `create_ticket`, the engine saves the exact proposed arguments and pauses. Approval resumes that same run and executes that call; rejection returns a denial to the model. Limits and estimated cost continue across resumes. At the end, PostgreSQL atomically saves the terminal state, final event and one metric row. Hourly analytics summarize those metric rows; optional TimescaleDB accelerates that query through a continuous aggregate. The current Docker database already supports the raw PostgreSQL analytics path.

1. The route authenticates, bounds/validates the JSON body and resolves a saved agent using its verified owner.
2. `runAgent()` snapshots configuration and policy, creates a run and records `run_started`.
3. The engine checks cancellation/deadline, model/tool counts, context size and estimated budget before additional work.
4. It reserves estimated model cost durably and makes exactly one AI SDK generation request. Tools have schemas/descriptions but no automatic executor attached to the SDK. Only the guarded dispatcher can invoke them.
5. It reconciles reported usage, records the model event, validates tool calls, and executes calls serially. Tool results retain the provider tool-call IDs in the conversation.
6. A write in evaluation mode gets a denial result. An interactive write saves the exact pending call and checkpoint atomically, records `approval_required`, and ends the response without executing the write.
7. A later approval request claims that decision once, records resolution, and resumes the same run. An approved write executes with its saved arguments; a rejected call produces a denial result. Every additional write needs a new approval.
8. Completion, a policy stop or a failure persists final state before its event is sent to the browser.

**Runtime-owned execution loop.** One loop provides a single place to enforce approvals, counters, budgets and checkpoint state. The AI SDK handles provider protocol and structured output; it does not own application authorization or the database workflow.

**Serial tool execution.** This keeps approval ordering, matched results and event sequences predictable during the hackathon. A single model response can request several calls, so both model and tool counts are bounded.

**Durable approval pauses.** Human approval may take minutes, so the stream closes after saving the pending call. Durable state and a fresh resume request survive page refresh/process replacement without leaving a request asleep.

**Persistence before streaming.** The timeline describes work retrievable from history. Essential persistence failure stops further execution. Runtime exceptions are mapped to safe failure reasons rather than exposing provider bodies or credentials.

Event persistence does not depend on `onEvent`. Server-side evaluations and runs without a live listener retain the same complete trace. If an active subscriber throws, the runtime stops before more work and records `event_delivery_failed`. If completion or an approval pause has already been committed, a delivery failure preserves that durable state; history replay supplies the saved event. A failure while delivering approval resolution records a failed run before executing the write rather than leaving it running.

## Shared configuration and tool contracts

The authoritative browser-safe types and Zod schemas live in `lib/agents/contracts/index.ts`. Example agent configurations and complete event lifecycles live in `lib/agents/fixtures/index.ts`. Import those definitions rather than maintaining parallel interfaces.

Store each agent in an `Agent` row whose `config` satisfies `AgentConfigSchema`. Configuration ID, owner and version must match the row. Fields are `id`, `ownerId`, `version`, `name`, `instructions`, `model: "gemini"`, enabled tool IDs, mandatory write approval, and validated limits. Tools are referenced by ID; never put executor code or Zod objects in database JSON.

Default limits are five model calls, ten tool calls, $0.05 estimated model cost, 512 total output tokens per call and 30 seconds of active runtime across resumes. Schema maxima prevent clients/configuration from requesting arbitrary limits. HTTP run requests cannot override policy. Text prompts are bounded, context serialization is capped at 100 KB, and each tool result at 32 KiB of JSON.

Each tool implements `ToolDefinition` from `lib/agents/tools/registry.ts`:

- Stable `id`, useful `description`, trusted `kind: read | write`.
- A synchronous, JSON-schema-compatible Zod object input schema. Keep validation deterministic/idempotent; avoid side-effecting transforms.
- Async `run(input, context)`, returning display-safe JSON data, honoring the abort signal and applying resource ownership checks.
- Context contains owner, run ID, tool-call ID and a run/call idempotency key. Scope integration data to that owner; do not accept ownership from the model's arguments.

Register tools in the server registry assembled in `runtime/services.ts`. Keep browser catalog metadata separate from executors/credentials. The runtime validates permitted IDs both at selection and dispatch. Write classification comes from trusted registry code and cannot be downgraded by an agent prompt or generated draft.

The demo ticket implementation uses a parameterized PostgreSQL `INSERT ... ON CONFLICT DO NOTHING`, followed by a lookup. This avoids an observed race in empty-update Prisma upserts. Reusing a key with different owner/arguments is rejected. The unique key makes concurrent identical requests produce one ticket.

## Events, streaming and API

All endpoints use the demo bearer authorization adapter. Replace `authorize()` with verified session ownership when integrating multi-user authentication; never ship the shared API token in a browser bundle. A trusted server-side session-aware proxy can call these endpoints during integration.

- `POST /api/agents/[id]/run`: `{ "message": "..." }` → NDJSON events.
- `POST /api/approvals/[id]`: `{ "approved": true }` (or false) → resumed NDJSON events for the same run.
- `POST /api/agents/draft`: `{ "goal": "..." }` → `{ draft, usage }` JSON.

Requests are capped at 16 KiB and body reading has a 10-second deadline. Stalled bodies return 408 (`body_timeout`); disconnected reads return 408 (`request_aborted`). Body size/time failures cancel the source without waiting indefinitely for cancellation acknowledgment. Already-disconnected requests do not start streamed execution, and response-reader cancellation propagates the abort signal to active runtime work. Unexpected body fields are rejected. Before streaming, invalid bodies return 400, missing/wrong authorization 401, missing runtime auth/configuration 503, inaccessible records 404, and unavailable/reused approvals 409. A failure after response headers have been sent is represented in execution events; HTTP 200 alone does not mean success. An essential store/transport failure may terminate the stream; the client must not mark a run successful without its completion event.

Event envelopes contain `schemaVersion`, `eventId`, `runId`, increasing `sequence`, ISO `timestamp`, `type` and a typed `payload`. Events cover run start/end/block/failure, model start/finish, tool request/start/finish/failure, and approval request/resolution. Tool-call IDs correlate requests/results. Unknown usage is null, not implicitly zero. Events contain operational data, not private model reasoning. Tool implementers must return only input/output data safe for the UI.

Read streamed POST responses with `fetch()` and a reader, not native `EventSource`. Buffer partial NDJSON lines because network chunks can split events. `approval_required` closes the response; reopen through the approval endpoint after the decision. Do not rerun the original prompt when replaying history.

```bash
# In a local shell with RUNTIME_API_TOKEN set, after npm run dev:
curl -N http://localhost:3000/api/agents/support-demo/run \
  -H "Authorization: Bearer $RUNTIME_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Use knowledge_search to check whether an unused product can be returned after 20 days."}'

curl -N http://localhost:3000/api/approvals/APPROVAL_ID \
  -H "Authorization: Bearer $RUNTIME_API_TOKEN" \
  -H 'Content-Type: application/json' -d '{"approved":true}'

curl http://localhost:3000/api/agents/draft \
  -H "Authorization: Bearer $RUNTIME_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"goal":"Answer policy questions and create tickets after approval."}'
```

## Persistence, approvals and evaluations

`PrismaRunStore` persists AgentRun, RunEvent, Approval and checkpoint state. Its important operations are create/load, appendEvent, versioned saveCheckpoint, atomic pauseForApproval, atomic claimApproval and atomic finishRun. Checkpoints carry conversation messages, pending calls, completed IDs/results, usage, counters, model fingerprint, approval mode and active time. Configuration snapshots preserve historical behavior even if the original agent is edited/deleted.

`finishRun` also inserts one `RuntimeMetric` row in the same transaction as the terminal state/event. It records owner/agent/version/model profile, outcome/reason, finish time, active duration, model/tool counts and nullable token/cost totals. Metrics contain no prompts, answers, tool arguments/results or checkpoint. Running/approval-waiting runs do not count as finished metrics; historical runs finalized before the metrics migration are not backfilled. Deleting a run cascades to its metric. Unknown usage remains null rather than being reported as zero. The composite run/time primary key supports optional TimescaleDB time partitioning; optimistic run finalization prevents duplicate metrics for a run.

PostgreSQL allocates event sequences under row updates; unique run/sequence pairs preserve ordering. Optimistic checkpoint versions reject stale updates. Approval claims update pending/unexpired records and claim the waiting run in one transaction; simultaneous decisions cannot both resume it. Approval expires after 15 minutes. A stored call cannot be replaced through client-supplied arguments/history.

Approval payloads contain schema-normalized inputs, including defaults and transformations, so the review shows the arguments that will execute. Each decision applies only to its stored call; it cannot authorize a later call even if registry read/write metadata changes while paused. Rejection still skips that call after reclassification. If a changed schema produces different arguments on resume, the run blocks with `approval_input_changed`; start a new run to review the new arguments.

Builder edits and rollbacks create new configuration versions. A waiting run resumes its saved configuration snapshot; a new run loads the current version. Integration coverage creates through the builder store, edits during approval, resumes the original version, rolls back, and executes the restored version.

Call `PrismaRunStore.history(runId, ownerId, afterSequence)` for safe history projection. It includes summary, usage and ordered events; it does not expose the checkpoint. Deduplicate events by event ID and retain sequence numbers across approval/resume. Browser history should not expose database checkpoints or raw model messages.

The server-side evaluation runner calls `runAgent({ config, ownerId, message, approvalMode: "deny" }, dependencies)`. It gets the same `AgentRunResult` and events with no approval wait or write side effect. Playground bodies cannot select this execution mode. The HTTP layer and reusable engine are separate so tests do not require a browser/server loopback request.

### Integration decisions for the merged playground

The browser must never receive `RUNTIME_API_TOKEN`. The current bearer adapter deliberately authorizes the single `demo` workspace. A browser-facing adapter must establish its own trusted session/workspace context before invoking the runtime; merely injecting the secret into an unauthenticated proxy would expose execution to arbitrary callers. The proposed `/api/playground/...` routes in the UI are placeholders, not existing authenticated endpoints. Keep mock mode until the chosen adapter and history endpoint pass integration tests.

For history, use `PrismaRunStore.history(runId, verifiedOwnerId, afterSequence)` and pass its safe projection through the UI's history schema. The monitoring branch owns list queries and endpoints. `AgentRun.version` is the checkpoint lock counter; the agent revision is `configSnapshot.version`. Never serialize `loadRun()` directly to the browser because it includes the checkpoint.

Agent headers can show `config.model` as the provider key, `limits.maxModelCalls` as the model-step cap, and `limits.maxEstimatedCostUsd` as the estimated model budget. A server-side display adapter can supply the configured model ID. Model duration is derived from paired start/finish event timestamps; model events intentionally contain no private reasoning. A completed run after a denied write is still `completed`; a UI rejection badge must remain a display classification rather than rewriting persisted status or the metrics definition.

Draft suggestions contain `{ input, expectedBehavior }`. Preserve the expected behavior as a proposed assertion for review; do not silently convert prose into deterministic `mustCall`/`mustContain` checks or mark it passed. A semantic grader is separate from the runtime's evaluation mode, which only enforces execution policy. A bounded grader, persistent test results and a server-verified publish gate remain evaluation integration work.

## Draft generation

The goal and trusted tool catalog go to Gemini using `generateText` with `Output.object` and the draft schema. The result contains name, instructions, model key, tools with reasons, assumptions and suggested tests. Cleanup rejects unknown/duplicate tools and forces approval on registry-defined writes regardless of generated suggestions. Drafting does not save the agent or execute tools. Suggested tests have not passed merely because the model proposed them.

Draft generation has a 30-second deadline, bounded input/output and a $0.05 estimated per-request model budget. Review the returned draft, then persist the configuration with a newly assigned ID, owner, and version.

A draft must finish normally (`stop`) and stay within 2048 total output tokens. Valid JSON alone is insufficient: filtered, malformed, truncated or otherwise incomplete provider responses are rejected before the draft is returned. These checks also apply when the builder invokes the shared draft generator through its server action.

## Cost accounting and recovery limits

Budget enforcement estimates input from UTF-8 serialized context/schema size plus margin and reserves bounded output before a model call. Actual usage replaces that reservation afterward. Missing/partial provider usage stops further spending; the Google adapter checks raw metadata because SDK normalization can otherwise turn absent fields into zeros. Interrupted/failed calls retain the reserved estimated cost with unknown token totals, since they may still be billed. Automatic billable retries are disabled.

This is an **estimated model budget**, not a guaranteed provider invoice ceiling. Reasoning is included in total output usage and cost. Only text and the selected provider profile are supported; no paid grounding, media generation, explicit cache storage or external paid tool charges are implied. Recheck pricing/profile assumptions before adding them.

Run states are running, waiting_approval, completed, blocked and failed. Stable stop reasons include step_limit, tool_limit, budget_limit, usage_unknown, context_limit, output_limit and model_policy_changed. Interrupted/deadline-expired runs fail with interrupted_or_timeout; unexpected provider/tool failures use execution_failed rather than leaking exception content. An active event subscriber failure uses event_delivery_failed; already-persisted completion/approval-pause states remain authoritative even if their notification fails.

The engine accepts normally finished text/tool turns (`stop` or `tool-calls`). Provider-filtered turns block with `model_content_filtered`; other unsuccessful finish reasons block with `model_incomplete`. Reported usage is persisted first, but partial text is not returned as a successful answer and included tool calls are not queued or executed. Truncation keeps the existing `output_limit` reason. Injected test drivers may omit a finish reason; the Google adapter always supplies the SDK's reason.

Waiting approvals survive refresh/process replacement. Active operations honor cancellation where the underlying integration supports it; a non-cooperative side effect may finish after cancellation. A process crash can leave an active run marked running. This prototype does not include a lease/recovery worker and does not automatically replay crashed writes. External writes require integration-level idempotency or reconciliation; a database claim alone cannot guarantee exactly-once delivery.

Async `onEvent` callbacks share the run deadline. A stalled callback cannot keep an active run open indefinitely: timeout persists `interrupted_or_timeout` and prevents additional work. Already-persisted completion and approval pauses remain authoritative if delivery times out. Subscriber code should still honor cancellation for its own external work.

Approval cancellation has two boundaries. A disconnect observed before the database claim returns HTTP 408 without consuming the approval. Once claimed, the streaming task always hands control to the runtime, even if the request has disconnected; the runtime persists cancellation as `interrupted_or_timeout` instead of leaving a claimed run running. That decision is consumed and cannot be retried. A cancelled run does not automatically replay writes; inspect history before starting a new run. This handles request cancellation, not process crashes.

## Verification and current limits

```bash
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
```

Unit tests validate schemas, fixture lifecycles, registry enforcement, HTTP boundaries, early event delivery, draft cleanup and actual AI SDK/Google protocol mapping with simulated HTTP responses. PostgreSQL integration tests cover atomic approvals, ownership, expiry, stale checkpoints, both agent/tool paths, denial/resume, cost/step/deadline stops, conservative unknown usage, storage failure and concurrent ticket idempotency. End-to-end tests call real route handlers/runtime/tools/database while simulating only Gemini HTTP responses. They clean up only their own records.

Real provider availability, answer quality and deployed UI integration require separate live checks. Never describe simulated responses as live Gemini success.

The default Turbopack production build currently fails here in the unchanged scaffold CSS pipeline because its worker cannot bind a local port. A supported one-off `npm run build -- --webpack` verifies production compilation as an environment fallback; the default scripts remain Turbopack. Initial Google Font fetching may also need network access. Record these separately from runtime test failures.

### Live smoke command and verified result

```bash
npm run runtime:smoke -- --live
```

This explicitly opts into real Gemini API requests. It runs read-tool checks, approved/rejected ticket checks, and drafting using the configured model/key. Each run has a $0.02 estimated budget and bounded steps/output; drafting has a separate $0.05 estimate limit. The command deletes only its own run/ticket records and prints pass/fail plus an estimated aggregate cost, never the key or generated private messages. It does not seed/overwrite saved agents.

On October 24, 2026, all five live checks passed against the configured Gemini 3.1 Flash-Lite model and local PostgreSQL; the reported aggregate model-cost estimate was **$0.001239**. This establishes live runtime/tool/approval/draft functionality, not broad recommendation quality or production reliability. Keep the key/token in `.env` and configure them separately on deployment.

### Verification status

Verified on October 24, 2026:

- Initial feature verification passed 20 unit tests and 17 PostgreSQL integration tests. Follow-up verification is recorded below.
- TypeScript and lint checks passed.
- All five live Gemini smoke checks passed.
- Production compilation passed with the one-off webpack fallback.
- The default Turbopack worker-port restriction remains an environment limitation. Session authentication, application UI integration, and deployment require their own integration checks.

### Post-merge reliability fixes

- `aae11f6`: persist complete execution history without an event callback, including evaluation write denials.
- `53bce30`: stop active runs safely on subscriber failure and preserve durable completion/pending approval states when only delivery fails.
- `da80c51`: bound body reads, cancel stalled sources, and propagate request/response disconnects without starting cancelled work.

These changes preserve the existing API request/event schemas, database schema, dependencies, and default Turbopack configuration. History remains available through the existing owner-scoped store API.

Post-merge batch verification on October 24, 2026: **25 unit tests and 23 PostgreSQL integration tests passed**, together with TypeScript, lint and one-off webpack production compilation. All five live Gemini smoke checks passed again; the batch's aggregate model-cost estimate was **$0.001267**. No database migration, dependency change, or API schema change was required.

### Builder integration and approval hardening

The next batch binds approval decisions to exact calls, normalizes reviewed inputs, rejects schema drift, and bounds async event subscribers. It integrates the merged builder/versioning implementation from main (`f9455dc`), regenerates Prisma Client, and applies its `20261025000000_agent_versioning` migration. No new dependency or runtime API schema is introduced.

The merged agent editor also needs `app/agents/[id]/loading.tsx`: this supplies the Suspense boundary around request-time parameters/database reads required by Cache Components. The production build verifies that route can prerender its loading shell while fetching fresh agent data.

Batch verification on October 24, 2026: **26 unit tests and 28 PostgreSQL integration tests passed**, plus TypeScript, lint and one-off webpack production compilation. All five live Gemini smoke checks passed (aggregate estimated model cost **$0.001248**). Default Turbopack remains configured and still encounters the environment's CSS-worker port restriction.

### Cancellation handoff and provider completion verification

The next grouped batch verifies cancellation before/during an approval claim, and prevents unsuccessful provider turns from executing tools or completing answers. Protocol tests cover Google's filtered/malformed/unspecified finish reasons; drafting tests also reject truncated or oversized output containing valid JSON.

Verified on October 24, 2026: **35 unit tests, 30 PostgreSQL integration tests, TypeScript and lint passed**. All five live Gemini smoke checks passed (aggregate estimated model cost **$0.001269**). Production compilation passed with the one-off webpack fallback; default Turbopack still hits the CSS-worker port permission error in this environment. No dependency, migration or request/event schema change was needed. Consumers may display the new `model_content_filtered` and `model_incomplete` stop reasons from existing blocked events.
