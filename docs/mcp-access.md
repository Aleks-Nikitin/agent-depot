# Scoped MCP status access

The selected MCP direction is an inbound, read-only management endpoint at `/api/mcp`. AgentDepot does not connect to arbitrary external MCP servers, execute downloaded tools, accept remote executor URLs or start subprocesses from model instructions.

Open **MCP access** while signed in with a registered account. Select up to 20 owned agents, one or more read tools, and a lifetime from one to 30 days. The key is shown once and stored only as a SHA-256 hash. Configure a trusted MCP client with the displayed endpoint and `Authorization: Bearer <access-key>`. Revoke it in the app when no longer needed. Rotation means creating a replacement key and revoking the previous one; old credentials cannot be retrieved.

This is a manually provisioned bearer-token flow. OAuth discovery, consent redirects, dynamic client registration, stdio and SSE subscriptions are not implemented. Clients requiring automatic MCP OAuth cannot connect through that flow. The endpoint supports stateless Streamable HTTP with JSON responses and protocol revisions `2025-11-25` and `2025-06-18`. GET, DELETE and OPTIONS return 405 after transport authorization because there is no resumable server session or event stream. POST notifications are acknowledged with 202. Request cancellation stops response processing/delivery; an already-started database read may finish.

Available tools:

- `list_agents`: names, draft versions and serving pointers for the key's selected owned agents only.
- `get_release_status`: one selected agent's draft and serving-pointer metadata.
- `get_test_summary`: latest recorded certification-suite status and aggregate counts, with `authorizesPublication: false`. A recorded passing suite is not proof that current dependencies still authorize publication.

No tool saves configurations, runs a model, starts a worker job, creates an external issue, approves an action, publishes or rolls back a release. Instructions, customer knowledge, evaluation prompts/answers, credentials and private checkpoints are excluded from responses. Agent names are untrusted data, never permission. The endpoint does not widen existing application capabilities or use the MCP transport itself as authorization.

## Transport and scope controls

Every request checks the key's current expiry/revocation, owner, exact allowed tools and agent IDs, canonical endpoint audience and pinned static tool-catalog hash. The tool schema/description catalog is server-authored; model text cannot register or alter tools. Catalog drift invalidates existing keys rather than silently granting changed capabilities.

Configure the public application origin through `BETTER_AUTH_URL`. Production and non-loopback access require HTTPS. The incoming host must match that canonical host, and a supplied Origin must match exactly. Native clients may omit Origin. Reverse proxies must preserve the canonical host. Browser session cookies alone never authorize MCP calls; key management separately uses the normal authenticated same-origin API.

Requests are limited to 16 KiB and bounded body-reading time. Tool inputs use strict schemas; unexpected owner IDs, credentials, URLs and executor fields are rejected. Responses contain bounded metadata for at most 20 agents. Each key is limited to 60 requests per minute, enforced with atomic PostgreSQL counters; a workspace may hold ten unexpired active keys. Invalid and expired keys fail closed. Requests admitted before revocation can finish their read; later requests are denied. Use an HTTPS reverse proxy and its normal request controls before deployment.

`GET/POST/DELETE /api/mcp/keys` list safe key metadata, create scoped access, and revoke an owned key. The raw key is returned only by creation with `Cache-Control: private, no-store`; keep it in the client's credential configuration, never in an agent instruction or committed file.

## Verification

Three offline PostgreSQL tests cover a real official TypeScript MCP SDK client performing initialize → tool discovery → scoped calls, plus cross-owner access, extra arguments, invalid origins/hosts, catalog/audience changes, expiry, revocation, request bounds, rate limits and cancellation. The client uses an in-process HTTP bridge to the actual route handler, so it makes no external or paid requests. This verifies client/protocol interoperability; deployed TLS, proxy host forwarding and a separately installed end-user client remain deployment checks.

References: [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [MCP authorization guidance](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
