# Releases and conversations

Saved drafts and serving releases have separate lifecycles. Editing a draft never redirects serving traffic. Publishing creates an immutable approval artifact and atomically changes `Agent.servingReleaseId`. The existing publish button promotes the displayed draft; Versions offers a one-click restore of a previously approved serving release without editing the draft.

## Storage and promotion

`Agent` holds the editable head. Every save appends an `AgentDraft` revision; Prisma maps this name onto the existing `AgentVersion` table so historical IDs and revisions survive migration. Database triggers reject updates to draft and release artifacts. Restoring a draft creates another revision.

`AgentRelease` retains the source draft ID, normalized configuration and hash, server-approved provider model/pricing/retry settings, approval actor/time, and a hashed copy of evaluation results. Promotion holds the same agent row lock as saves, test-definition edits and suite starts. It requires the latest suite for that revision to be completed and passing, with the exact configuration hash, current test fingerprint, current provider settings, and one passing result per current test. Empty, partial, stale and unavailable evidence cannot promote. Client `testsPassed` flags have no authority. `expectedVersion` optionally rejects stale publish requests; the Tests UI supplies it.

Rollback uses the retained approval artifact, checks its hashes and ownership, and compares `expectedGeneration` to prevent overwriting a newer pointer change. It preserves the draft and original evidence. Newer failed drafts or changed test cases do not erase historical approval. Current tool availability, permissions and invocation policy are still enforced on every execution. Release snapshots do not freeze knowledge documents, domain data, tool implementation code, credentials, or a workspace policy manifest. Broader dependency certification is not implemented here.

Older `published` flags are not automatically trusted as release artifacts. After migration, agents need fresh complete evaluation evidence and publication before serving execution. Generate Prisma and apply tracked application migrations before restarting the application; retain the separately installed graph checkpoint schema described in [runtime setup](langchain-runtime.md).

## Execution API

All endpoints require an authenticated owner session, including isolated guest sessions. Mutations retain the same-origin check.

- `POST /api/agents/:id/publish` accepts `{ "expectedVersion": 3 }`. Success preserves the existing agent-detail response and includes the serving release ID/generation.
- `POST /api/agents/:id/releases/rollback` accepts `{ "releaseId": "<id>", "expectedGeneration": 2 }`.
- `POST /api/agents/:id/execute` accepts only `{ "message": "..." }` and requires an `Idempotency-Key` header containing 1–128 letters, digits, underscores, dots or hyphens. It resolves only the active serving artifact; unpublished agents return `409 no_serving_release`. Clients cannot supply a configuration or release override. Responses use the existing NDJSON events.
- `POST /api/agents/:id/run` remains a single-run draft compatibility endpoint. Playground conversations use the selected immutable draft revision through the session API below.

The serving pointer is read once for each new execution; subsequent promotion cannot alter that run. Request keys are scoped to the owner and agent. Reusing a key replays the original run, even after promotion; changing its message conflicts. A unique run insert wins before any billable model request or tool effect, preventing racing retries from duplicating execution. An in-progress replay can end without a terminal event; read the saved run rather than assuming success or sending a new write request.

## Pinned conversations

- `POST /api/agents/:id/sessions` accepts `{ "target": "draft", "version": 2 }` (version defaults to the current draft), or `{ "target": "release" }` to pin the current serving artifact.
- `POST /api/agents/:id/sessions/:sessionId/messages` accepts `{ "message": "..." }` and requires an `Idempotency-Key` scoped to that conversation.
- `GET /api/agents/:id/sessions/:sessionId` returns the pinned version, target, expiry and public turn/run references. Configuration snapshots, provider settings and private checkpoint state are omitted.

Playground lets the owner select a draft or serving revision, shows the pinned badge, and retains the session ID in its URL. Reloading restores prior turns and their saved traces. “New conversation” starts another session on the selected revision. The header independently shows current Draft vN and Serving vM. Each turn remains a distinct run with its own limits, cost accounting and approvals; Runs includes playground and serving traffic by default, excluding evaluations. Its API also supports explicit `source=playground`, `serving`, `test` or `interactive` filtering.

Conversations expire after 24 hours and allow at most ten turns. The retained application history plus the next input is limited to 48,000 UTF-8 bytes; the runtime also enforces its existing context and per-turn execution/spend limits. LangGraph uses one persistent thread per conversation, retaining native assistant/tool messages and provider signatures. Application history remains available for limits and injected test drivers. Editing a draft, promoting/rolling back another release, or changing model/pricing environment settings does not silently change an existing session. Credentials still come only from the current server environment.

Run creation atomically claims the session and advances its turn counter. Only one turn can run at a time; approval pauses keep the claim until terminal settlement. Repeated request keys replay the existing run. Failed or blocked turns require a new conversation, preventing a new input from continuing an unfinished graph cursor. Crashed workers and expired approvals can leave a session occupied; automatic reconciliation and background worker recovery are not supplied by these endpoints. Retention/deletion of vendor checkpoints is a separate operational responsibility.

## Verification boundary

Local deterministic PostgreSQL checks cover serving isolation through v1/v2/v3, atomic promotion and rollback conflicts, stale/incomplete evidence, request deduplication, ownership, immutable artifacts, pinned multi-turn/provider history, graph persistence, conversation limits, and approval pause/resume. They make no live provider, hosted database or deployment claim.

Final local checks: typecheck, lint, 119 unit tests and 24 focused PostgreSQL integration checks passed. The production build could not complete in the restricted execution environment: the Turbopack CSS worker was denied a local port bind, including after an elevated retry. Production-build verification remains outstanding; Turbopack configuration was preserved. No live model calls were used.
