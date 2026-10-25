# Playground integration status

This replaces the original mock-screen handoff. The default product paths now use session-authorized PostgreSQL data and the actual runtime. See [Application integration](integration-README.md) for implementation and verification details.

## Connected

- One shared session-aware navigation, including guest workspaces and login/signup prompts.
- Saved-agent metadata, real limits, current and published revision badges.
- HTTP event streaming, approval pause/resume, persisted replay with sequence cursors and run-detail links.
- Owner-scoped run list/detail/metrics, pagination and a trend derived from recorded runs.
- Unified registry with six planned integrations and the legacy ticket demonstration; writes require approval.
- Dedicated Versions navigation with saved YAML and append-only restore.
- Persisted test cases and runs, actual runtime execution with writes denied, deterministic assertions and optional Gemini policy grading.
- Expected behavior retained from drafted tests; publication checks exact version and test fingerprint inside a server transaction.
- Tools & Knowledge tab with private documents and recorded email demonstrations.
- Dashboard introduction, real recent activity, starter templates and approval shortcuts.

## Deliberate display conventions

Runs use short UUIDs. Rejected approvals can display as rejected even when the runtime later completes. Model labels describe observed actions; private model reasoning is never exposed. Model-step durations are derived from event timestamps. Success rate is succeeded divided by finished runs; unfinished runs are excluded. Charts and dashboard cards explicitly describe their bounded history scope. Unknown token/cost/duration data is shown as unknown.

## Remaining optional work

No schedule editor, global search, public trace sharing, confidence score, automated issue-summary button or enterprise certification is claimed. Multi-model selection and billing are separate work. Tests are release evidence, not proof of security or reliability in every circumstance. Saved test suites are currently synchronous and bounded; a disconnected request may end early, and Run Tests can retry. Browser-triggered save/restore requests tests when cases exist; API clients explicitly call the evaluation endpoint.

Live hosted Tiger analytics, live GitHub provider consent and Vultr deployment retain their separate verification status in their respective documentation. Curated search results are labeled demo data when no SerpApi key is configured. Recorded email never delivers mail.

Fixtures remain explicit test/design utilities; production UI defaults do not select them.
