# Developer 3 placeholders: what's missing and who fills it

The playground, runs and tests screens are built against fixtures. Each item below is a gap in what exists on `main` today.
Search the code for `PLACEHOLDER(P<n>)` to find where each gap is stubbed.

Status: open = not started · asked = raised with owner · done.

## Needs another developer

| # | Gap | Owner | Where it's stubbed | Status |
|---|-----|-------|--------------------|--------|
| P1 | Root `SiteNav` now mounts the shared `TopNav` only for sessions; duplicate page navs and body `:has` header-hiding rules were removed by the auth integration. | Auth integration | `components/auth/site-nav.tsx` | done |
| P2 | No `/agents/[id]/versions` route. Versions live inside the Builder today, so the Versions tab links to the Builder for now. Either add the route or drop the tab. | Dev 1 | `components/shell/agent-tabs.tsx` | open |
| P3 | Better Auth session cookies now authorize the execution and approval routes directly, including guests. HTTP client paths use the actual routes; no bearer proxy is needed. History and mock-mode switch remain P7/P5/P16. | Auth integration | `lib/playground/http-client.ts` | done |
| P4 | Fixture tools `send_email` and `google_shopping` are not in the registry yet (today: `knowledge_search`, `sales_lookup`, `create_ticket`). UI renders any tool id, so only fixtures change. | Dev 4 | `lib/fixtures/scenarios.ts` | open |
| P6 | Agent header fields. `config.model` is always `"gemini"`; the real model id (`RUNTIME_MODEL_ID`) is server-side only. "max 8 steps" maps to `limits.maxModelCalls`; "cost cap" to `limits.maxEstimatedCostUsd`. Published/draft comes from `Agent.published` / `publishedVersion`. Confirm the header should read these. | Dev 1 + Dev 2 | `components/shell/agent-header.tsx` | open |
| P7 | No "list runs" query in `PrismaRunStore` (only `history(runId)`). `GET /api/runs` needs a list by owner/agent/status. Note: `AgentRun.version` is the checkpoint lock counter, **not** the agent version; use `configSnapshot.version`. | Dev 3 (reads Dev 2's tables) | to build in `lib/runs/queries.ts` | open |
| P8 | No `TestCase` / `TestRun` tables in `prisma/schema.prisma`. Proposed: `TestCase { id, agentId, input, checks Json, source }`, `TestRun { id, agentId, version, results Json, passed, createdAt }`. | Dev 1 (schema owner) | Tests tab uses fixtures | open |
| P9 | Publish gate trusts the client: `PublishRequestSchema` takes `{ testsPassed: boolean }` from the browser. It should check server-side that the latest `TestRun` for that version passed. | Dev 1 + Dev 3 | `lib/evals/publish-gate.ts` (to build) | open |
| P13 | Gemini grader ("did it follow the policy?") and "Summarize issues with Gemini" need a server-side model call. Reuse the runtime's model adapter, don't add a second one. | Dev 2 + Dev 3 | Tests tab | open |
| P14 | Draft suggested tests are `{ input, expectedBehavior }`, but our test cases are `{ input, mustCall, mustNotCall, mustContain }`. Decide how a Gemini-suggested test becomes checks (prompt Gemini for checks, or convert `expectedBehavior` to a grader check). | Dev 2 + Dev 3 | Tests tab | open |

## Team decisions needed

| # | Question | Current default | Status |
|---|----------|-----------------|--------|
| P11 | Show a run that finished after a rejected approval as **rejected**? The runtime records it as `completed`. | Yes, display-only status `rejected` (`lib/runs/format.ts`) | open |
| P12 | Run numbers like "#129". Run ids are UUIDs; nothing gives a sequential number. Add a counter, or show a short id? | Short id until decided | open |
| P17 | Model steps in the design show text ("Decided to look up the refund policy…"). Events carry no model text by design (no private reasoning). | Label from what followed, e.g. "Requested knowledge_search" | open |
| P18 | Per-model-step duration isn't in the event; it is derived from `model_started` → `model_finished` timestamps. Tool steps have a real `durationMs`. | Derived | open |
| P21 | Success-rate definition. Implemented: `completed ÷ (completed + rejected + blocked + failed + interrupted)`, excluding running and waiting runs; the card says "succeeded ÷ finished runs". | As implemented (`lib/runs/metrics.ts`) | open |
| P22 | Mockup items left out because no data exists for them: global search, notifications/settings/avatar, "Save Draft"/"Deploy" in the header, system-status footer (latency, cluster, tokens/s), "+1.4% vs yesterday", p50/p99, "Total today", auto-refresh, date-range filter, pagination, "Share trace", "Integrity checksum", "Confidence score", "Temperature", "Sandbox safety". Add any back once a real source exists. | Left out | open |

## Mine to finish later

| # | Item | Status |
|---|------|--------|
| P5 | Flip `CLIENT_MODE` from `"mock"` to `"http"` once P3 exists (`lib/playground/use-run.ts`). | open |
| P10 | Delete the dev-only design gallery at `app/dev/ui/page.tsx` before the demo. | done |
| P16 | Backend phase: `app/api/runs`, `app/api/runs/[id]`, `app/api/agents/[id]/tests/run`, `lib/evals/checks.ts`, `runner.ts`, `publish-gate.ts`, and swap `lib/runs/queries.ts` from fixtures to the database. | open |
| P15 | Line chart: hand-rolled SVG so `package.json` (Dev 1) stays untouched. Switch to Recharts only if the team adds it. | open |
