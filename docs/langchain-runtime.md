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

OpenAI requires `OPENAI_API_KEY`, `OPENAI_RUNTIME_MODEL_ID`, `OPENAI_RUNTIME_INPUT_USD_PER_MILLION` and `OPENAI_RUNTIME_OUTPUT_USD_PER_MILLION`. There is no implicit model or rate default. `openai-fallback` is a catalog role; automatic provider fallback is not enabled by this adapter. Neither adapter retries provider calls automatically. Actual provider/model availability and pricing require separate verification.

## Policy, events and persistence

LangChain owns model/tool iteration. Application middleware reserves estimated cost before each model call, reconciles reported usage, validates completion, and enforces time, context, model, tool, write and output limits. There is one provider request per model step. Tools are hidden when disabled, retired or disconnected and are checked again against the trusted registry at invocation. Zod validation, output bounds, owner context and run/call idempotency keys remain enforced by the application dispatcher.

Framework tool callbacks execute serially. Pending intent is saved before effects, completed tool results are persisted, and repeated callbacks reuse those results. This is not a claim of general crash-safe exactly-once external effects: ambiguous effects still require reconciliation. Evaluation runs deny writes. Reviewed writes interrupt the graph before execution; approval claims retain ownership, expiry, exact normalized arguments and single-use checks. Resume uses the same server-created run ID as the graph thread ID and checks the saved model/rate fingerprint.

Prisma remains authoritative for application status, approval claims, ordered events and atomic terminal metrics. Graph checkpoints remain private and are not returned by history/export APIs. Existing legacy checkpoints retain the compatibility path; new service-created runs use the graph adapter. Full worker recovery, provider fallback and aggregate spend accounting remain separate work.

## Optional metadata tracing

Tracing is off unless `LANGCHAIN_TRACING_V2=true` and `LANGSMITH_API_KEY` (or `LANGCHAIN_API_KEY`) is present. `LANGSMITH_PROJECT`/`LANGCHAIN_PROJECT` can select the project. Native graph/model payload tracing is suppressed in the SDK context. The optional terminal trace contains a run UUID, status, timing and token/cost counters, with empty inputs/outputs; it excludes prompts, answers, owner IDs, tool arguments/results and checkpoints. The SDK may also discover server capabilities with a payload-free GET. Terminal metadata export uses one request with a short timeout and no retries; export failures are ignored. Database evidence remains authoritative.

## Verification boundaries

Focused tests use local PostgreSQL and deterministic model responses. They cover native Gemini tool protocol/thinking-token accounting, compatible persisted events, checkpoint reads through a fresh saver, write denial, unknown usage, ownership rejection and single-use approval resume. They do not establish live Gemini/OpenAI availability, hosted database access, worker crash recovery or deployment readiness.
