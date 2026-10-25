# Authentication and personal workspaces

Better Auth 1.7.12 supplies email/password, GitHub OAuth and isolated guest sessions. This adapts HeavyFuel's Better Auth/Prisma pattern to agent ownership. Stripe is a later milestone and is not installed or implemented here.

## Local setup

Keep the local PostgreSQL target and follow the root database setup, then:

```bash
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

Configure these values in ignored `.env`:

- `BETTER_AUTH_URL=http://localhost:3000`
- `BETTER_AUTH_SECRET`: a newly generated random secret of at least 32 characters, unique to this application. Never reuse HeavyFuel's secret.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: credentials for this application's GitHub OAuth app. Without both, email and guest authentication remain available but GitHub is disabled in the UI.
- `RUNTIME_ALLOW_DEMO_TOKEN=false`: normal browser access uses database sessions. Never expose the existing runtime bearer token in browser code.

GitHub OAuth app settings: **Homepage URL** `http://localhost:3000`; **Authorization callback URL** `http://localhost:3000/api/auth/callback/github`. The login/signup page is `/auth`. An OAuth app uses the provider's default `read:user` / `user:email` scopes; a GitHub App additionally needs permission to read email addresses. [Better Auth GitHub setup](https://better-auth.com/docs/authentication/github)

Restart the server after changing auth settings; the server auth instance is initialized lazily and retained per process. Production requires an HTTPS `BETTER_AUTH_URL`, matching provider callbacks, its own secret and exact configured origin. No secrets use `NEXT_PUBLIC_*` or appear in this document.

## Backend and ownership

- `lib/auth.ts`: existing Prisma PostgreSQL adapter, email/password, conditional GitHub provider, encrypted stored OAuth tokens, seven-day database sessions, anonymous plugin and `nextCookies` last. Cookie-cache sessions are disabled so revoked sessions are checked in the database. Better Auth's request protections and in-process rate limiter stay enabled.
- `app/api/auth/[...all]/route.ts`: GET/POST handler for Better Auth's signup, sign-in, session, sign-out and callback endpoints. Responses are uncached; unexpected failures return a generic unavailable error.
- `lib/auth/session.ts`: verified session user IDs for request and page authorization. Cookie-authenticated mutations require the configured Origin and reject cross-site requests. Page helpers redirect anonymous visitors to `/auth`.
- Builder CRUD/version routes, agent drafting, runtime execution, approval and metrics endpoints derive owner IDs from sessions. A browser cannot pick an owner in a header or body. The engine's existing owner checks still enforce record access.

The additive migrations create HeavyFuel-compatible `user`, `session`, `account` and `verification` tables, with unique email/session token and indexed user references. Provider/account identity is also unique. The separate guest migration adds `user.isAnonymous`. No store/order/payment/admin-role fields are carried over. Passwords are hashed by Better Auth; sessions/accounts reference users with cascading deletion.

Existing agent/run/metric owner strings remain compatible with historical data and internal runtime tests. New browser-owned records use the verified User ID; existing `demo` records are not automatically assigned to any account. Agent/run tables do not gain a cascading user foreign key or an automatic data migration. Account deletion and email-change-without-verification from HeavyFuel are deliberately not enabled. Automatic social-account linking is disabled; email and GitHub accounts with an existing matching email require a deliberate future linking workflow.

The old bearer path is only available with `RUNTIME_ALLOW_DEMO_TOKEN=true`, an explicit Authorization header, and a non-production environment. It authorizes the old `demo` workspace for local scripts/tests, never a browser proxy. It is disabled in production even if configured. Default requests use sessions. The owner-aware engine itself remains reusable without HTTP for evaluations.

## Guest access

`POST /api/auth/sign-in/anonymous` creates a distinct anonymous User and session. Each guest can create, edit, duplicate, version and execute agents, approve their own writes, and read their own metrics through the same authorization path as a registered account. No role or paywall restriction is added. Runtime tool permissions and per-run cost/step/time limits still apply.

Guests share neither accounts nor a `demo` owner ID. Losing the cookie, session expiry or signing out removes access to that guest workspace; there is no recovery credential or guest-to-account data transfer in this milestone. Guest data is not automatically deleted on logout, and no retention cleanup job is included. Existing fixture-backed playground/test/history screens remain fixtures until their separate backend integration is completed; guest access does not change their implementation status.

## Verification and limits

Run `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, then a production build. Integration tests use real Better Auth handlers, cookies and PostgreSQL. They check hashed credentials, sign-in/out, session revocation, owner-scoped builder CRUD, cross-site and forged-owner rejection, protected execution/approval/metrics, separate guest workspaces, OAuth initiation/state rejection and a complete OAuth callback with simulated GitHub responses. Only the provider/model HTTP responses are simulated; these checks are not live GitHub/Gemini verification. Tests remove their own records.

Email verification, password-reset delivery, MFA/enterprise SSO, organization membership, durable distributed rate limits, guest conversion/retention and Stripe subscriptions are not implemented. The server-side publish gate's existing test-result placeholder and the UI's mocked execution/history remain separate integration work. This is authentication groundwork for the prototype, not an assertion of enterprise readiness.

Live GitHub verification needs the configured OAuth app and an interactive login; no HeavyFuel credentials are copied. Verify deployed HTTPS cookies, origins, callbacks and sign-out separately from local tests.
