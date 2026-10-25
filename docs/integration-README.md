# Application integration

The integration branch connects the merged builder, shared engine, tools, playground, run history and Evaluation Lab into the create -> test -> release -> observe workflow. The reference plan's five screens already exist; missing connections are tracked below. Existing Better Auth sessions and isolated guests remain the authorization boundary.

## Backend foundation

- Repaired the merged package scripts and replaced stale synchronous owner lookups with explicit verified owner IDs in run/evaluation queries and APIs. Removed saved-agent header fallback to made-up fixture agents.
- Runtime, drafting and the builder catalog now use one registry: knowledge search, seeded sales lookup, Google Shopping, Google News, webpage extraction, recorded email, and the original ticket tool for compatibility. The guarded dispatcher still owns validation, enabled-tool enforcement, limits and write approval. The development direct-tool bypass now returns 410.
- Workspace knowledge is stored in PostgreSQL and searched alongside the labeled sample company policies. Other users' documents are excluded. Recorded email is durable and idempotent; it is explicitly a demo action and delivers no email. Evaluations deny writes.
- Runtime records now tag the actual agent version and distinguish test versus playground runs. Owner-scoped run queries preserve history snapshots and do not return checkpoints.
- SerpApi uses existing fetch, cancellation and ignored local cache. Curated fallback results carry `demo: true` and are used only without a key; they are not proof of live search. Extract parsing uses the documented `text_content` response. [SerpApi Extract API](https://serpapi.com/extract-api)

Apply additive migrations and regenerate Prisma after pulling:

```bash
npm run db:generate
npm run db:deploy
```

Restart an existing dev server after generating the client. Keep credentials in the environment. No dependency or bundler change was needed.

## Integration milestones

- Backend foundation: implemented; deterministic and database regression checks accompany the code.
- Live playground/history and Versions navigation: implemented. The HTTP client now executes real saved agents and streams durable runtime events; saved-run URLs replay history and reopen approval pauses. Run detail links back to the saved playground. The history API supports incremental `after` sequence replay without checkpoints. Run lists have an explicit loaded-history scope and pagination. Global Playground/Tests links open owner-scoped agent pickers instead of nonexistent demo agents. A dedicated Versions tab displays saved YAML and restores a revision as a new version.
- Evaluation Lab: implemented. POST `/api/agents/:id/tests/run` snapshots 1–5 saved cases and the current config, runs the same engine with writes denied, checks tool/answer assertions and optionally grades policy/expected behavior with Gemini. Evidence is persisted with version and a hash of test definitions. Concurrent suites are serialized; suites have a 90-second deadline, each runtime has at most 30 seconds and an estimated $0.02 cap, and the suite reserves at most an estimated $0.10 including grading. Estimates are not an invoice guarantee. Unknown cost stops further paid work. Grading does not automatically retry.
- Publishing: the server checks the latest completed passing evidence inside a transaction with the agent lock. Client `testsPassed` flags have no authority. Editing tests invalidates evidence; a new saved/restored version needs its own run. Old runs without a fingerprint cannot unlock publishing. Saved template/draft tests preserve expected behavior; builder saves and restores automatically request tests when cases exist. API clients can explicitly request evaluation. Duplicating copies reviewed test definitions with new case IDs, without copying release evidence. Concurrent saves and restore keep revision history append-only. Tests show measured tool failures, common assertion failures, and previous-version pass rate; no made-up quality score is displayed.
- Tools/Knowledge management: implemented. The new tab shows the actual registered tools, SerpApi configuration status, private persisted documents with add/delete, included sample policies and the workspace's recorded demo emails. The dashboard adds a Gemini product introduction, working starter-template links, saved agents, the latest 50 playground runs, a finished-run success rate and approval shortcuts. It shows no invented activity. Navigation adapts to narrow screens.
- Verification: 102 unit and 60 PostgreSQL integration tests pass, with TypeScript, lint and the default Turbopack production build. Browser checks used an isolated guest, live Gemini and local PostgreSQL: template create → automatic suite (3/3 pass) → publish; live knowledge lookup → write pause → page reload/replay → approval/resume → saved run detail → recorded-email listing. The suite estimated $0.0017 and the playground run estimated $0.0007. These are model usage estimates, not invoices. SerpApi was not configured during browser checks. Hosted Tiger remains blocked separately; no hosted write/read success or external deployment is implied.

The temporary root integration backbone is local-only and excluded from Git. This public document records shipped behavior and remaining work, not credentials or private development notes.

## Walkthrough

1. Sign in or continue as guest. Each guest gets a private workspace.
2. Start a support/pricing template or draft with Gemini; inspect instructions, tool permissions and limits. Template/draft creation includes suggested cases.
3. Save. The builder requests the saved suite automatically; open Tests to inspect results and their recorded traces. Manual agents need at least one case. API clients can call the evaluation endpoint after saving.
4. In Playground send a question. Read calls execute immediately; a write displays its exact arguments and pauses. Approve or reject. Email is a database record only.
5. Open Runs to inspect the persisted answer, tool events and usage, or reopen a saved playground URL to review/resume a pending approval.
6. Publish from Tests after the current evidence passes. Saving/restoring creates a new revision; the previous published version remains visible while new checks run.
7. Open Versions for saved YAML/restore and Tools & Knowledge to add private text or inspect recorded emails.

No public dashboard numbers imply a hosted Tiger write. `DATABASE_TARGET` still selects the existing database, with local PostgreSQL available. No additional dependency, payment, deployment, or provider integration was introduced here.
