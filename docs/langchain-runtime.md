# LangChain runtime adapter

New application runs use LangChain `createAgent` and persistent LangGraph checkpoints. The existing `runAgent`, `resumeAgent`, `AgentRunResult`, and sequenced `RunStep` interfaces remain compatible with the playground and evaluations. AI SDK drafting and grading remain separate consumers.

## Local setup

After installing dependencies and starting PostgreSQL:

```sh
npm run db:generate
DATABASE_TARGET=local npm run db:deploy
npm run runtime:setup
```

`runtime:setup` runs the checkpoint vendor's migrations in the dedicated `langgraph_checkpoints` schema on the selected application database. Run it explicitly during deployment with a role allowed to create that schema/tables. Prisma owns application tables; it does not manage the vendor tables. Model execution does not run schema migrations. The shared `DATABASE_TARGET` selector still supports only `local` and `tiger`.

Each existing owner receives one `Workspace` container, including legacy owners without an auth record. New registrations and agent creation ensure a container exists. Resources still use existing owner IDs and authorization checks; collaborative memberships and workspace policy are not introduced here.

## Provider profiles

Legacy `model: "gemini"` configurations resolve to `gemini-primary` without rewriting saved revision JSON. An optional `modelProfile` accepts only `gemini-primary` or `openai-fallback`; API saves, duplicates and restores preserve explicitly selected profiles. The current builder continues to submit Gemini configurations.

Gemini uses the existing `RUNTIME_MODEL_ID`, positive text-pricing variables and `GOOGLE_GENERATIVE_AI_API_KEY`. Gemini 3.1 retains minimal thinking and includes reported thinking tokens in output accounting. Missing raw Google usage remains unknown instead of becoming zero. The installed Google adapter needs a small compatibility wrapper for those billing fields and the minimal-thinking type.

OpenAI requires `OPENAI_API_KEY`, `OPENAI_RUNTIME_MODEL_ID`, `OPENAI_RUNTIME_INPUT_USD_PER_MILLION` and `OPENAI_RUNTIME_OUTPUT_USD_PER_MILLION`. There is no implicit model or rate default. Set `RUNTIME_FALLBACK_PROFILE=openai-fallback` (or an explicit saved `fallbackModelProfile`) to approve automatic fallback from Gemini. All fallback credentials, model ID and positive rates must be configured; there is no silent substitute. `RUNTIME_MODEL_MAX_RETRIES` defaults to 1 and accepts 0–2 retries per provider/model step. Only rate limits, provider outages and connection failures are retried or routed to the approved fallback. Bad credentials, unsupported models, invalid requests and missing response usage stop. Once selected, the fallback continues for the rest of the run. SDK-level retries remain disabled; application middleware owns each attempt. Actual provider/model availability and pricing require separate verification.

## Policy, events and persistence

LangChain owns model/tool iteration. Application middleware atomically saves a `ModelAttempt` and estimated reservation before each model call, reconciles reported usage, validates completion, and enforces time, context, model, tool, write and output limits. There is one provider request per model step. Tools are hidden when disabled, retired or disconnected and are checked again against the trusted registry at invocation. Zod validation, output bounds, owner context and run/call idempotency keys remain enforced by the application dispatcher.

Framework tool callbacks execute serially. Pending intent is saved before effects, completed tool results are persisted, and repeated callbacks reuse those results. This is not a claim of general crash-safe exactly-once external effects: ambiguous effects still require reconciliation. Evaluation suites execute supported domain writes in isolated fixture state and deny other writes; see [isolated evaluation setup and limits](isolated-evaluations.md). Explicit deny-write runtime callers retain that behavior. Reviewed writes interrupt the graph before execution; approval claims retain ownership, expiry, exact normalized arguments and single-use checks. Each reviewed tool task has its own persisted graph interrupt ID, so a decision resumes only that call. A SHA-256 hash binds the normalized call to its owner, run, tool and call ID in both the application approval and graph resume payload. Changed payloads and old unhashed approvals cannot authorize execution. Resume uses the same server-created run ID as the graph thread ID and checks the saved model/rate fingerprint.

On cancellation, application middleware finishes durable reservation/settlement work before terminal state is saved. Prisma remains authoritative for application status, approval claims, ordered events and atomic terminal metrics. Graph checkpoints remain private and are not returned by history/export APIs. All new runtime and evaluation runs use the graph adapter; the bespoke loop is removed. Old non-graph checkpoints remain readable, but cannot resume effects and require a new reviewed run. Worker crash recovery and aggregate workspace spend accounting remain separate work.

## Attempt accounting and recovery display

Every billable attempt counts toward `maxModelCalls`, including retries and fallbacks. A failed request retains its full conservative reservation; a successful response reconciles only its own reservation. Missing usage in a response stops execution. Unknown billing from a failed request stays unknown in final usage, even if fallback completes; its reservation remains charged against the per-run spend cap. This permits bounded recovery without inventing zero cost. `ModelAttempt` rows contain actual profile/provider/model, status, reservation, nullable usage/cost and timing, without prompts or tool data. Terminal metrics identify the last actual profile.

The playground and replay show each attempt's actual model, failed attempts, “Retrying” and “Using fallback.” Recovery retries the model request with completed tool evidence; it does not replay tools or restart the agent graph.

## Optional metadata tracing

Tracing is off unless `LANGCHAIN_TRACING_V2=true` and `LANGSMITH_API_KEY` (or `LANGCHAIN_API_KEY`) is present. `LANGSMITH_PROJECT`/`LANGCHAIN_PROJECT` can select the project. Native graph/model payload tracing is suppressed in the SDK context. The optional terminal trace contains a run UUID, status, timing and token/cost counters, with empty inputs/outputs; it excludes prompts, answers, owner IDs, tool arguments/results and checkpoints. The SDK may also discover server capabilities with a payload-free GET. Terminal metadata export uses one request with a short timeout and no retries; export failures are ignored. Database evidence remains authoritative.

## Verification boundaries

Focused tests use local PostgreSQL and deterministic model responses. They cover native Gemini-to-OpenAI fallback with a committed ticket, conservative failed-attempt reservations, missing-usage stops, approval payload tampering, native Gemini tool protocol/thinking-token accounting, compatible persisted events, checkpoint reads through a fresh saver, write denial, unknown usage, ownership rejection and single-use approval resume. They do not establish live Gemini/OpenAI availability, hosted database access, worker crash recovery or deployment readiness.
