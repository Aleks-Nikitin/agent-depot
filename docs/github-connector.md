# GitHub issue connector

The connector supports one explicitly selected GitHub repository per workspace. Login OAuth does not supply repository integration access. Use a separate fine-grained token restricted to that repository, with Issues read permission, or Issues read/write when issue creation is needed. Configure an expiry and revoke it in GitHub when no longer needed. Repository issue access is checked on connection; write permission is checked by GitHub when executing the approved action.

Set `CONNECTOR_ENCRYPTION_KEY` to 32 random bytes encoded as 64 hexadecimal characters in server secrets. This is a dedicated AES-256-GCM key, independent of authentication secrets. Keep it stable across web/worker restarts. Credential ciphertext is authenticated against its owner, connection ID and revision. Missing or changed keys fail closed. Never put tokens or this key into agent instructions, model context, public environment variables or Git. Back up the key separately using your deployment's secret manager; key rotation requires reconnecting credentials with the new key.

Connecting or rotating replaces the credential and increments the connection revision. Agent configurations bind the connection ID and exact revision. Previous configurations and pending approvals cannot silently gain access to a replacement credential or another repository. Disconnect erases stored ciphertext and invalidates the binding. In-flight writes finish before disconnect returns; completed external issues are not deleted by disconnect. Revoking the token in GitHub independently stops provider access.

External write intent is recorded before the HTTP request. A successful result is retained for replay of the same run/call, with mismatched arguments rejected. A timeout, crash or malformed response leaves an unknown outcome: the POST is never automatically repeated. Reconciliation reads at most 300 recently updated issues and matches the exact submitted title/body and operation marker. No match, multiple matches or a changed/deleted issue remains unknown and requires manual review. These bounds trade automatic recovery for avoiding duplicate writes. Known access, validation and rate-limit rejections are recorded without retries.

The implementation uses fixed GitHub API endpoints, refuses redirects, applies time and response limits, and returns bounded issue fields. Repository moves require reconnecting deliberately. Tokens are resolved only by server executors and are excluded from connection metadata, tool arguments, results and execution checkpoints.

Local verification uses three PostgreSQL integration tests with replayed GitHub responses: encryption/ownership/revocation, ambiguous completion and reconciliation, and status handling/idempotent success. A real GitHub side effect is a separate opt-in verification.

## Using the connector

Open **Tools & knowledge → GitHub issue triage** to connect, rotate or disconnect access. Anonymous sessions cannot connect credentials. In an agent's **Connections** tab, select read issues and/or propose issue creation, then save. This creates a new draft with a pinned connection revision; it does not change the serving release. Existing builder saves preserve the binding. Rotating a token requires saving a new binding and re-evaluating publication evidence.

`github_list_issues` returns up to ten recent issues, excluding pull requests. `github_create_issue` proposes an exact repository, title and body for the existing approval flow. Approval is mandatory even when the agent allows other automatic writes. The executor rejects any repository other than the pinned connection. Treat fetched issue text as untrusted content, not instructions or permission. Successful tool events include the issue URL. Tools are hidden when unconnected/revoked and both reads and writes are blocked during isolated evaluations; an evaluation attempt is not a live integration test or proof of external success.

Recent operations link to their saved execution evidence in Tools & knowledge. **Check GitHub for completion** only performs bounded reads; it never resends an uncertain POST. Disconnect waits for an already-running write to settle and prevents later calls. It does not recall completed external effects.

Authenticated, same-origin endpoints:

- `GET/PUT/DELETE /api/connectors/github`: metadata/operations, connect or rotate, disconnect.
- `POST /api/connectors/github/reconcile`: `{ "key": "run-id:call-id" }` for an owned unknown operation.
- `PUT /api/agents/:id/github`: `{ "expectedVersion": 1, "read": true, "write": false }` to save a pinned agent draft.

References: [GitHub Issues REST API](https://docs.github.com/en/rest/issues/issues), [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).

### Live verification

On November 12, 2026, the repository owner authorized one disposable issue in `Aleks-Nikitin/agent-depot`. [Verification issue #24](https://github.com/Aleks-Nikitin/agent-depot/issues/24) was created through `runAgent` → persistent approval interrupt → `resumeAgent` → the connector executor. The durable operation confirmed completion. This used a deterministic verification driver, with no live model calls and no customer data. Temporary credential access was disconnected and erased afterward. This proves the connector's live issue effect and approval path, not a live model's triage quality or a deployed end-user credential flow.
