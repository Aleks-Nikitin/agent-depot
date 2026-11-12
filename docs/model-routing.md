# Opt-in model routing and matched comparisons

Open an owned agent's **Routing** tab to save a routing policy as a new draft. The existing serving release is unchanged. Agents without a routing policy retain their original provider/fallback behavior. Older builder saves preserve an existing routing policy; the Routing tab explicitly restores original selection. Duplicate and restore operations retain the selected policy.

The first router is deterministic and makes no model call. It either locks an approved profile or selects the lowest estimated cost at the policy's declared minimum context size plus maximum output allowance. This is a cost proxy, not a guarantee that every actual prompt is cheapest on that profile. It does not infer task complexity, alter instructions, downgrade the configured Gemini model, or silently choose another profile when a credential disappears.

## Policy and operator declarations

A version-1 policy binds:

- An explicit list of approved trusted profile IDs and allowed provider destinations.
- An optional profile lock. Locked execution disables cross-profile fallback.
- Required context capacity, a matching data-policy tag, maximum declared latency, and highest approved cost tier.
- Existing tool support: an agent with enabled tools requires a declaration supporting tools.

The supported IDs remain `gemini-primary` and `openai-fallback`. Model IDs, credentials and rates are resolved through the existing server profiles. Callers cannot supply a provider URL, arbitrary model, credential, executable selector or router prompt. Workspace budgets, tool permissions, approval checks and resource ownership still apply.

The operator configures `ROUTING_PROFILE_CATALOG` as a bounded JSON object in the private server environment. For example, this **illustrates the declaration format**, not verified provider capacity, latency, retention terms or production approval:

```json
{
  "gemini-primary": {
    "model": "gemini-3.1-flash-lite",
    "contextTokens": 8192,
    "tools": true,
    "expectedLatencyMs": 10000,
    "costTier": "standard",
    "dataPolicyTag": "synthetic-only"
  }
}
```

Before using a declaration, verify its model ID matches that profile's configured model and choose approved conservative limits. Add `openai-fallback` only after configuring its model/rates and reviewing its capability/data-policy declaration. No capability is invented when the catalog is missing. A tag is an administrative matching rule, not automatic content classification or proof of provider compliance. Declared latency is a selection constraint, not a measured service guarantee. Actual case latency is reported separately.

The catalog is pinned with provider settings in new routing-enabled run/evaluation/release snapshots. Missing declarations, mismatched model IDs, unapproved destinations, inadequate context/tool support, data-policy mismatch and excessive declared cost/latency exclude a candidate. Empty eligibility fails closed. Removing a credential makes the selected provider unavailable; it does not silently authorize another model. An enabled fallback must also satisfy the routing policy, and existing retry accounting remains authoritative.

Before each provider attempt, the runtime compares a conservative full UTF-8 prompt/tool serialization estimate, a 4,096-token margin and the output allowance against the selected profile's declared context capacity. Overflow blocks before reserving or invoking a provider. This first version routes against an approved context envelope; it does not automatically move an oversized request to a larger model. Increase the approved envelope or explicitly choose another profile and retest.

The persisted `model_started` application event adds routing justification, candidates/exclusion reasons, declared-context estimates and policy-selected profile. The run detail page shows these alongside the actual profile/model for each attempt. A fallback remains separately recorded through normal recovery events. No credential is included in routing metadata. Snapshot identity and the driver's policy hash prevent incompatible continuation after policy/catalog changes.

## Primary-only versus routed benchmark

Review saved cases as held-out evaluation tasks, save the routing policy, then choose **Run isolated comparison**. The saved primary profile must itself be approved and eligible. The user acknowledges the held-out use and ordinary provider costs. The application records this intent; it cannot prove the owner never used these tasks while tuning prompts.

The background worker interleaves primary-only and routed arms on exactly the same entire saved suite, fixtures, knowledge and policy. Primary-only locks the saved primary profile with no cross-provider fallback. The routed arm uses the saved policy. Choose one or two repeats per arm: at most four suites. Each suite retains the existing $0.10 estimated budget, case/run/deadline limits and shared workspace reservations. Estimated limits are not a guarantee about provider invoices; unknown usage remains conservatively reserved.

These are shadow evaluations: domain mutations use the existing isolated `agentdepot_eval` database and per-attempt schemas. They cannot create live workspace tickets. The benchmark never creates a draft, changes the serving pointer or promotes a release. Real provider execution still requires configured credentials and incurs normal charges; fixture verification does not replace those responses in production.

Before each child snapshot commits, the server rechecks the original draft/test/knowledge/tool/policy/provider manifest. Dependency changes stop further admission. A snapshot uses one captured knowledge object for both dependency validation and the actual arm manifest. Stable parent/ordinal keys and child receipts prevent duplicate suites after restart. Parent progression is serialized by a database advisory lock. Child completion or conservative interruption wakes the parent; ambiguous provider/effect execution is not blindly replayed. Cancellation is cooperative and retains completed observations and existing charges.

`RoutingBenchmark` retains the owned request, bounded repeats, workload identity and child receipts. Ordinary `ExecutionJob`/`TestRun` records execute each arm. Benchmark `TestRun.purpose` is **`benchmark`**; normal certification defaults to **`certification`**. Latest evaluation reads, quality history, repair baselines and promotion queries exclude benchmark records. Passing a comparison cannot unlock publication, and a benchmark child is not shown as a normal active certification suite.

## Reading the report

Reports show behavior pass count, deterministic state correctness, behavior failures, unavailable/unobserved trials, actual provider attempts, unknown-usage attempts, estimated total cost, known-cost lower bound, cost per successful task, and case p50/p95 latency. Every requested case/repeat stays in the denominator, including skipped or missing trials. Failed and retried calls remain part of recorded cost. A null cost is unknown; totals and cost per success stay unknown until all expected trials have complete accounting. No successful task means cost per success is undefined.

State correctness and answer/tool-policy success are separate. A model can write the correct ticket and still fail an answer requirement. Grading remains optional per saved case, with unavailable grading treated as unavailable rather than a pass. Latency percentiles use only recorded durations and display their observation count, including known failed-case durations. They measure the case execution path, not an advertised provider-only latency.

The descriptive Wilson pass interval assumes independent trials. Repeats share tasks, so it is not independent evidence or a production quality guarantee. Small samples and missing observations must remain visible. No savings percentage or quality improvement is inferred automatically.

Version comparison requires the same agent and workload identity: exact cases/fixtures/assertions, knowledge, tool declarations, parent/runtime policy and provider declarations. Draft version and instructions/routing may differ intentionally. Changed workload dependencies produce an incompatibility warning instead of matched metrics. Each report retains its original version and links actual traces/state evidence. Export downloads the authenticated owner's selected report data, excluding private checkpoints and credentials.

## Setup, APIs and verification

Regenerate Prisma and apply the additive routing-benchmark migration to the intended database. Keep the existing Graphile worker, runtime checkpoints and isolated evaluation database configured. No additional provider SDK, router service or cloud resource is required.

All endpoints enforce authenticated ownership and same-origin mutation rules:

- `GET/POST /api/agents/:id/routing`: read selected policy/declarations/history; save `{ expectedVersion, routing }`, with null explicitly restoring original selection.
- `POST /api/agents/:id/benchmarks`: `{ expectedVersion, repeats, heldOutAcknowledged: true }` with an `Idempotency-Key`; returns 202 with benchmark ID.
- `GET /api/benchmarks/:id?compareTo=:otherId`: recorded observations and optional matched version comparison.
- `POST /api/benchmarks/:id/cancel`: `{}`.

Run `npm run typecheck`, `npm run lint`, `npm test` and the relevant offline local integration checks. Verification uses deterministic synthetic drivers: selection exclusions/locks, overflow before billing, repeated paired suites, exact state writes, quality/cost tradeoffs, owner isolation, idempotency, changed dependencies, cancellation and certification separation. These are implementation checks, not measurements of current Google/OpenAI model quality, live cost savings, hosted deployment or real provider latency. Any live benchmark is a separate explicitly authorized paid verification.

Final local verification passed type checking, lint, 128 unit tests and the full 96-test offline PostgreSQL integration suite. The final three focused benchmark checks also passed, including entirely passing shadow results that cannot publish. The standard Turbopack production build was attempted and remains blocked by the execution environment denying its CSS worker a local port bind. No alternative bundler, paid provider call, hosted deployment or interactive browser verification is claimed.
