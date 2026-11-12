# Workspace limits and estimated spend

Each owner has one workspace policy in PostgreSQL. Agent drafts, restores, duplicates, queued execution, approval resumes and provider attempts must stay inside that policy. Public browsing and builder previews remain available. A browser cannot supply or widen its parent policy through an agent payload.

## Policy

`Workspace.policy` is operator-managed JSON with these fields:

```json
{
  "allowedTools": ["knowledge_search", "sales_lookup", "order_lookup", "create_ticket", "send_email", "google_shopping", "google_news", "read_webpage"],
  "dailyBudgetMicros": 1000000,
  "maxConcurrentRuns": 4,
  "limits": {
    "maxModelCalls": 10,
    "maxWriteCalls": 5,
    "maxToolCalls": 20,
    "maxEstimatedCostUsd": 1,
    "maxOutputTokens": 2048,
    "timeoutMs": 120000
  }
}
```

These are the migration defaults: $1 of estimated model spend per UTC day and four admitted runs/calls. Agents still have their own smaller default per-run limits. Operators can narrow the tool list and any limit; malformed policies fail closed. There is no public policy-edit endpoint in this change. Operator policy updates must be intentional and use the existing owned workspace record. The retained `send_email` ID supports old configurations; the retired tool remains hidden and cannot execute.

Every enabled agent tool must appear in the parent allowlist, and every numeric agent limit must be at most its parent limit. The server rejects wider configurations instead of silently changing a saved revision. The runtime rechecks current policy before model attempts and tool invocation, including pinned releases and resumed approvals. A policy change during a model call cannot authorize a newly forbidden tool effect. Internal ticket writes also check the current allowlist under the workspace row lock in the transaction that commits their receipt and effect. Trusted runtime registry, resource ownership, Zod validation, approvals and tool policy remain additional requirements.

Evaluation manifests now bind the workspace policy under revision `workspace-limits-v2`. Changing parent settings invalidates old certification evidence even if the agent configuration still fits. Queued suites also verify their captured policy before starting. Rerun evaluations after applying this migration or changing policy before a new promotion. Existing approved artifacts are retained; execution always checks current policy.

## Spend reservations

`WorkspaceDay` tracks UTC date buckets in integer microdollars. `WorkspaceCharge` records unique model-attempt, grader or draft reservations. Under the workspace row lock, admission checks the remaining daily budget and commits a reservation before issuing the provider request. Runtime model reservations and `ModelAttempt`/checkpoint updates share one transaction. Different workers cannot both spend the same remaining allowance.

Successful calls reconcile to reported estimated cost, rounded up to whole microdollars. Known overages are recorded rather than hidden and prevent further reservations as appropriate. Failed requests, missing usage and interrupted workers retain their conservative reservation. Terminal run status, browser disconnection and deleting a run do not refund uncertain spend. A cancellation before any provider invocation can settle its known cost to zero. Settlement is bound to its original UTC bucket, including calls that span midnight. A fresh attempt after midnight reserves against the new day.

Draft generation and semantic grading use the same daily ledger and concurrency boundary. Drafting only advertises the workspace's permitted tools. Runtime middleware continues to own provider retries/fallback and per-run accounting; each retry reserves independently in the shared ledger. No second model retry loop is added.

The limits cover **estimated LLM spend**, not an invoice guarantee or accounting for search-provider fees, infrastructure, taxes or currency conversion. Provider metadata/pricing may be incomplete or actual usage may exceed a reservation. Unknown usage never becomes free usage. There is no payment purchase, automatic top-up, global signup budget, billing plan or operator adjustment UI in this change.

## Concurrency and guests

`WorkspaceSlot` admits queued/running runs and auxiliary drafting/grading calls. Admission counts active slots while holding the workspace lock. A queued run occupies a slot before its vendor job commits. Terminal completion, cooperative cancellation and approval pause release the slot; an approval decision reacquires one in the same transaction as its claim. If full, the claim rolls back and the approval stays pending. Evaluation cases each acquire their own run slot, then release it before optional grading.

Deleting a run removes its slot through a foreign key. A hard-killed worker conservatively retains active state until the existing queue recovery path settles it; slots are not expired merely because a request is slow. See [worker recovery and cancellation limits](background-execution.md).

In production, anonymous Better Auth users cannot start paid runs, evaluations, approval continuations or drafting. This is a server-side database check, including queued work, not a UI flag or browser-supplied role. They can still use public previews and their existing owned CRUD/read paths. Development guest execution remains available with normal workspace limits. The old demo bearer adapter remains disabled in production. These checks do not implement billing, guest conversion or a global abuse-prevention system.

## Setup and verification

Regenerate Prisma, apply tracked migrations and restart web/worker processes. The additive migration backfills active slots for existing running records that already have workspace containers; no reset or new database instance is needed. Policies, day buckets, charges and slots are application tables; graph/queue vendor schemas remain separate.

Three focused local PostgreSQL tests prove concurrent spend arbitration, known reconciliation and retained unknown spend; queued admission and atomic approval reacquisition; narrower configuration/runtime policy, changed evidence invalidation and production guest rejection. They use deterministic provider drivers and create/delete only their own fixture resources. No real provider spend or hosted enforcement is claimed.
