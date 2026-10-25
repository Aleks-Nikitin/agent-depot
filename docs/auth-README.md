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
- `lib/auth/session.ts`: verified session user IDs for request and page authorization. Cookie-authenticated mutations require the configured Origin and reject cross-site requests. Protected page rendering checks `pageOwnerOrNull` before returning content; the server-action helper redirects unauthenticated calls to `/auth`.
- Builder CRUD/version routes, agent drafting, runtime execution, approval and metrics endpoints derive owner IDs from sessions. A browser cannot pick an owner in a header or body. The engine's existing owner checks still enforce record access.

The additive migrations create HeavyFuel-compatible `user`, `session`, `account` and `verification` tables, with unique email/session token and indexed user references. Provider/account identity is also unique. The separate guest migration adds `user.isAnonymous`. No store/order/payment/admin-role fields are carried over. Passwords are hashed by Better Auth; sessions/accounts reference users with cascading deletion.

Existing agent/run/metric owner strings remain compatible with historical data and internal runtime tests. New browser-owned records use the verified User ID; existing `demo` records are not automatically assigned to any account. Agent/run tables do not gain a cascading user foreign key or an automatic data migration. Account deletion and email-change-without-verification from HeavyFuel are deliberately not enabled. Automatic social-account linking is disabled; email and GitHub accounts with an existing matching email require a deliberate future linking workflow.

The old bearer path is only available with `RUNTIME_ALLOW_DEMO_TOKEN=true`, an explicit Authorization header, and a non-production environment. It authorizes the old `demo` workspace for local scripts/tests, never a browser proxy. It is disabled in production even if configured. Default requests use sessions. The owner-aware engine itself remains reusable without HTTP for evaluations.

## Guest access

`POST /api/auth/sign-in/anonymous` creates a distinct anonymous User and session. Each guest can create, edit, duplicate, version and execute agents, approve their own writes, and read their own metrics through the same authorization path as a registered account. No role or paywall restriction is added. Runtime tool permissions and per-run cost/step/time limits still apply.

Guests share neither accounts nor a `demo` owner ID. Losing the cookie, session expiry or signing out removes access to that guest workspace; there is no recovery credential or guest-to-account data transfer in this milestone. Guest data is not automatically deleted on logout, and no retention cleanup job is included. Playground, saved tests and history now use the integrated runtime and PostgreSQL; their owner isolation is unchanged.

## Login UI and protected pages

`app/auth/auth-client.tsx` adapts HeavyFuel's sign-in/sign-up form and loading/error/mode states to the agent platform. It uses Better Auth's React client directly for email signup/login and GitHub/guest login, with fixed same-origin success/error destinations. Labels, password autocomplete, input limits, disabled pending controls and generic errors are included. A mode change clears the password and errors. No new icon, form or state library was needed.

Signed-out requests for saved agents/editors, Runs, Playground, Tests and Versions receive a **Log in / Sign up** popup instead of private content. The root promotion, new-agent form and tools catalog are public; saving or paid drafting opens authentication at the action boundary. The popup embeds the same email/GitHub/guest form. Closing it leaves only an access prompt and a button to reopen it; no agent/run/test contents are rendered. The native dialog provides focus trapping and Escape handling, and its heading labels it for assistive technology. The existing `/auth` page remains available as a standalone form.

`SiteNav` is the single root navigation. Signed-out visitors see the brand and sign-in link; the Agents/Runs/Playground/Tests links and account menu appear only with a session. Guest accounts show “Guest workspace.” Logout revokes the session and refreshes navigation. Shared navigation replaces the old CSS that hid the root header based on whether a workspace element existed elsewhere in the DOM.

Page gates are request-time server checks behind Suspense, following Next.js Cache Components guidance. Backend ownership checks apply independently to every protected API/action; hiding links or displaying a popup is never the authorization boundary. [Next integration](https://better-auth.com/docs/integrations/next)

## Verification and limits

Run `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, then a production build. Integration tests use real Better Auth handlers, cookies and PostgreSQL. They check hashed credentials, sign-in/out, session revocation, owner-scoped builder CRUD, cross-site and forged-owner rejection, protected execution/approval/metrics, separate guest workspaces, OAuth initiation/state rejection and a complete OAuth callback with simulated GitHub responses. Only the provider/model HTTP responses are simulated; these checks are not live GitHub/Gemini verification. Tests remove their own records.

Email verification, password-reset delivery, MFA/enterprise SSO, organization membership, durable distributed rate limits, guest conversion/retention and Stripe subscriptions are not implemented. The server-side publish gate's existing test-result placeholder and the UI's mocked execution/history remain separate integration work. This is authentication groundwork for the prototype, not an assertion of enterprise readiness.

Live GitHub verification needs the configured OAuth app and an interactive login; no HeavyFuel credentials are copied. Verify deployed HTTPS cookies, origins, callbacks and sign-out separately from local tests.

### Current verification

The backend milestone is `abefa66`. The UI milestone adds the shared login/signup/guest form, popup gates and one session-aware navigation. **68 unit tests and 43 PostgreSQL integration tests passed**, together with typecheck, lint and the documented one-off webpack production build. One earlier existing runtime test exceeded its five-second timeout while a build was running; the full suite passed on a sequential rerun without changing timeouts.

The default **Turbopack dev server works on localhost:3000** after Prisma generation, migration deployment and server restart. Browser checks verified guest login, an empty isolated workspace, agent creation, logout, and login/signup popups on the dashboard, run history, playground and tests. Closing the popup leaves no protected content; signup mode shows its additional name field. The disposable browser-test guest/agent were removed after logout. Live GitHub authorization remains pending even though the local provider settings are present; the full callback test uses simulated GitHub responses.


## Public onboarding

The root promotion, new-agent form and tools catalog are public. Saving a configuration, generating a Gemini draft, running tools and reading workspace records require a valid session. Clicking a protected builder action opens login/signup (including guest access) without clearing the form; OAuth restores a bounded tab-local draft. Agent lists, saved builders, runs, playgrounds, tests, versions and private knowledge remain owner-scoped. Guest sessions count as authenticated workspaces.
