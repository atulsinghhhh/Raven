# Dashboard — `@raven/dashboard`

The developer dashboard is the control center for Livqeno's infrastructure:
create projects, manage API keys and members, inspect rooms/connections/live
participants, configure webhooks, watch Chat and Live Streaming activity, and
read SDK integration instructions. A separate **Super Admin Portal**
(`/super-admin`) exists for Livqeno's own platform operators. Neither is a
video-conferencing app — the dashboard never joins a call itself (the one
exception, a disposable smoke-test token, is explicitly scoped down and
documented below).

## Architecture

```
Browser
   |
   v
Next.js dashboard (apps/dashboard)
   |  Server Components + Route Handlers (BFF) only —
   |  the browser never calls the Control API directly,
   |  and never sees the session JWT.
   |
   +-- HTTP: every mutation/read goes through lib/api-client.ts
   |
   +-- WebSocket: one Dashboard WS connection per browser tab,
   |   shared across every component that wants realtime —
   |   see "Realtime" below.
   v
Livqeno Control API (apps/api)
   |
   +-- PostgreSQL (projects, members, api keys, rooms, webhooks,
   |   notifications, RTC server registry, chat/live-streaming state)
   +-- Redis (rate limiting, JWT blocklist, dashboard WS token revocation)
   +-- Livqeno SFU fleet, over the node link (live room/participant state)
   +-- coturn (via the same RTC-token minting path)
```

`apps/dashboard/src/lib/api-client.ts` is the **only** file that knows the
Control API's base URL and constructs HTTP requests to it — every server
component/route handler goes through it, and it is never imported at
runtime from a `'use client'` component (only its exported *types* are,
which are erased entirely at build time).

### The BFF layer, in practice

Every one of the ~40 route handlers under `app/api/**` follows one shape:

1. `requireSessionToken()` (`lib/route-helpers.ts`) — reads the httpOnly
   session cookie server-side, or short-circuits with a 401.
2. Call the matching `ravenApi.*` function (`lib/api-client.ts`), passing
   the session token through as a bearer credential.
3. `handleApiError()` on failure — forwards the Control API's own
   status/code/message (never a raw stack trace), and forwards
   `requestId` too (see "Request correlation" below).

Client components never hand-roll `fetch().then(r => r.json())` against a
BFF route — `lib/client-fetch.ts`'s `readJson()`/`errorMessage()` are the
shared helpers every mutation UI (API keys, members, webhooks, project
settings) parses a response and error message through.

### Request correlation

`apiFetch` mints a `dash_`-prefixed request id for every outbound Control
API call and sends it as `x-request-id`; the Control API's own
`resolveRequestId` (see `apps/api`'s `request-id.util.ts`) honors an
inbound id instead of minting a disconnected one, and stamps every error
response with it (`AllExceptionsFilter`). `ApiError` carries whichever id
the API echoed back (or the one this BFF sent, if the API was never
reached at all), and `handleApiError` forwards it to the browser and logs
it server-side for any 5xx/unreachable failure. One id traces a single
failed request across both services' logs.

## Local development

```
pnpm dashboard:dev   # from the repo root — apps/dashboard on :3001
```

The Control API (`apps/api`) needs to already be running (`pnpm dev`, or
see `docs/local-development.md` for the full infra stack) — the dashboard
has no mock/offline mode; every page that isn't a static marketing route
calls the real API.

Real environment variables the dashboard reads (see
`docs/environment-variables.md` for the generated, complete list across
every Livqeno component — note that list's dashboard count includes
`RAVEN_API_KEY`, which only ever appears inside Quickstart code-sample
*strings*, never actually read at runtime):

| Variable | Default if unset | Notes |
|---|---|---|
| `RAVEN_API_URL` | `http://localhost:4100` | The Control API base URL. Server-only — read exclusively in `lib/api-client.ts`/`lib/super-admin-client.ts`, never sent to the browser. |
| `NEXT_PUBLIC_DOCS_URL` | `http://localhost:3200` | Where "Documentation" links point (`apps/docs` locally). Public by design — it's just a URL. |
| `NEXT_PUBLIC_SUPPORT_URL` | `mailto:support@mail.ravenstack.online` | Where "Support" points. |
| `NODE_ENV` | — (set by the tooling) | Only consulted for the session cookie's `secure` flag (`lib/session.ts`) — `false` outside `production`, so local HTTP still works. |

## Authentication

The dashboard reuses the Control API's existing JWT session auth
(`POST /v1/auth/{register,login,logout}`) — it does not implement its own
user store. The session JWT is held in an **httpOnly, `SameSite=Lax`**
cookie (`raven_session`), set by the dashboard's own Route Handlers
(`app/api/auth/{login,register}/route.ts`) after calling the Control API;
`app/api/auth/logout/route.ts` blocklists it server-side and clears the
cookie. No client component or client-side JavaScript ever reads the raw
token — `lib/session.ts`'s `getSessionToken()` is server-only
(`next/headers`'s `cookies()`).

The one deliberate, narrow exception: the CLI sign-in hand-off
(`/cli-auth`) puts the raw session token into browser JS memory just long
enough to POST it to a locally-running CLI process on `127.0.0.1`, gated
behind an explicit "Authorize CLI" click. This is the same loopback
pattern `gh`/`vercel` CLI login use, not a general-purpose exception.

Alongside email/password, the login and signup screens offer
**"Continue with GitHub"** and **"Continue with Google"** when the
deployment has those providers configured. The whole OAuth dance is
server-side (`app/api/auth/oauth/[provider]/{start,callback}/route.ts` on
this side, `/v1/auth/oauth/*` on the Control API's); the browser only sees
redirects and ends up with the exact same `raven_session` cookie a
password login sets. See docs/oauth.md for the full flow and provider
setup.

A post-login/OAuth `?next=` redirect target is always validated
(`lib/safe-path.ts`'s `safeInternalPath`) before being followed — an
absolute or protocol-relative URL falls back to `/dashboard` instead of
being honored, closing off a login-flow open-redirect.

`src/proxy.ts` (Next.js's post-15 renaming of `middleware.ts`) redirects to
`/login` when the session cookie is absent, for every `/dashboard/**`,
`/onboarding/**`, and `/super-admin/**` route, and routes between
`/dashboard` and `/onboarding` off the `raven_onboarding` hint cookie.
**This is a UX convenience only, not the authorization boundary** — see
below.

## Onboarding

First-run onboarding lives at `/onboarding`: a seven-step flow (welcome →
use cases → experience → stack → create project → connect → done) whose
answers persist through `GET/PATCH /v1/onboarding` and finish with
`POST /v1/onboarding/complete`. State lives server-side, so a closed tab
resumes at the last saved step. Accounts that predate the feature were
backfilled as completed and never see it. A Super Admin Portal account is
exempt unconditionally — "create your first project" has nothing to do
with an ops-only account. The project-creation step mints the first API
key through the normal show-once flow; the secret is displayed exactly
once there.

## Authorization

Every dashboard page/action calls the Control API with the session JWT,
and the API is what actually authorizes it — every project-scoped
controller calls `ProjectsService.authorize(projectId, userId, capability)`
before touching data. Frontend `capabilities` (an array the API sends per
member, `lib/permissions.ts`) drive which buttons/controls render, but are
**UX only** — hiding a "Manage" button here is not the security boundary,
and every mutation is re-checked server-side regardless of what the
dashboard rendered. A project that exists but the caller isn't a member of
returns the *same* 404 as a project that doesn't exist at all — never a
403, which would confirm the ID is real.

**`proxy.ts`'s cookie-presence check is never the source of truth for
"can this user see this data"** — bypassing it entirely would only ever
produce a 401/404 from the API, never someone else's data.

## Projects, members, and roles

`POST /v1/projects` (Control API) generates the project ID server-side —
the dashboard never lets a developer choose one. `GET /v1/projects` lists
only the caller's own and shared (member-of) non-archived projects.

Every project has one or more members, each with a role —
`OWNER`/`ADMIN`/`DEVELOPER`/`VIEWER`/`BILLING` — managed from **Project →
Members**. Two rules the API enforces and the UI mirrors so it never
offers an action the server will refuse:

- Only an owner may grant or remove the `OWNER` role.
- A project always keeps at least one owner — the last owner's
  remove/demote controls are disabled, with the reason stated in the UI.

Removing a member requires a second, restated confirmation
(`components/ui/inline-confirm.tsx` — see "Shared components" below), the
same pattern every other permanent, one-click-away action in the console
uses.

## Super Admin Portal

`/super-admin` is Livqeno's own internal operator console — a separate
console from the developer-facing dashboard (`lib/super-admin-nav.ts`,
`lib/super-admin-client.ts`, deliberately not sharing config or a data
client with `lib/nav.ts`/`lib/api-client.ts`). It covers developer account
management (suspend/unsuspend), platform-admin grant/revoke, cross-project
activity/audit logs, and per-product operational views (RTC fleet, Chat,
Live Streaming, API). Reached only by an account holding a
`PlatformRole` (`SUPER_ADMIN`/`ADMIN`/`SUPPORT`/`READ_ONLY`), re-checked
server-side by `PlatformRoleGuard` on every `/v1/super-admin/*` call
regardless of what the portal renders — the same "frontend capability
check is UX, not the boundary" rule as the regular dashboard. Every
mutating action here (suspend, revoke, change a usage allowance) requires
a stated reason and is written to the admin audit log.

## Allowed origins (Settings → Security)

`PATCH /v1/projects/:id/allowed-origins` replaces the project's browser
origin allow-list. Livqeno is multi-tenant, so this is per project, not one
`CORS_ORIGIN` for the deployment: project A listing `https://app-a.com`
must not authorize it for project B.

Two behaviours are worth knowing before reading the UI:

- **An empty list is open.** Every project predating the feature has one,
  and defaulting those to deny would break live applications for a setting
  nobody could have filled in. The card says so explicitly rather than
  looking like a configured-and-empty allow-list.
- **Localhost is always allowed by default**, on any port, via
  `allowLocalhostOrigins`. A developer moving from `:3000` to `:5173` never
  registers a port, and configuring production domains never breaks local
  work. Loopback only — `https://localhost.evil.example` is a real domain
  someone else owns and is rejected.

Entries are normalized and validated by the Control API, which names the
offending values rather than storing something that would never match.
Wildcards are refused on purpose. See
[browser security & CORS](../apps/docs/content/authentication/browser-security.md).

## API Keys

A thin UI over the Control API's key endpoints
(`POST/GET /v1/projects/:id/api-keys`, `DELETE /v1/projects/:id/api-keys/:keyId`).
The full secret (`publicId.secret`) is rendered **exactly once**,
immediately after creation, from the API's own one-time response — the
dashboard never stores it, never re-fetches it, and the list endpoint's
response shape (`ApiKeySummary`) has no field capable of holding it
(enforced by `apps/api`'s own Prisma `select` clause, not just the
frontend type). Copy-to-clipboard is transient (Clipboard API only —
nothing written to `localStorage`/`sessionStorage`).

Keys are scoped to an **environment** — `DEVELOPMENT`/`STAGING`/`PRODUCTION`
— set at creation and shown as a badge on every row, so a development
credential is never visually confused with one that reaches production.
There is no server-side "rotate" endpoint: **Rotate** in the UI is a
client-side convenience that performs the two real operations (create the
replacement, then revoke the old key) in the safe order, never a fourth
API operation pretending to be atomic. Revoke and Rotate both require a
restated, in-place confirmation before firing.

## RTC configuration & the token model

The dashboard explicitly documents (Quickstart page) and enforces
(no UI path exists to do otherwise) the required flow:

```
API Key → Developer Backend → Control API → short-lived RTC Token → Developer Browser → RTC infrastructure
```

The dashboard **cannot** and does not mint long-lived participant tokens
for normal use. The one exception is a **10-minute, fixed-permission
"test token"** (`POST /v1/projects/:projectId/rooms/:roomId/test-token`,
`DashboardRtcTokensController`) that lets a developer smoke-test a room
from the dashboard itself, authenticated by the developer's own session
JWT rather than a project API key. It is clearly labeled in the UI as
being for smoke-testing only, is not developer-configurable (TTL and
permissions are hardcoded), and is functionally identical to what a real
backend would request via the normal API-key-guarded endpoint.

## The RTC section

| Tab | Page | Backed by |
|---|---|---|
| Rooms | `rooms/`, `rooms/[roomId]/` | `GET /v1/projects/:id/rooms` |
| Connections | `connections/`, `connections/[connectionId]/` | Telemetry-sourced `Connection` history, cursor-paginated |
| Participants | `participants/` | Live state across the project's rooms |
| Servers | `servers/` | `GET /v1/rtc/servers` — **not** project-scoped |
| Diagnostics | `diagnostics/` | Live dependency probes |

### Rooms — real live state, not fake metrics

The `Room` Postgres row is a control-plane record only — it has no idea
whether anyone is actually connected. `SfuRoomStateService`
(`apps/api/src/modules/rooms/sfu-room-state.service.ts`) asks the room's
assigned SFU node over the node link, and the dashboard preserves a
three-way distinction all the way to the badge: **Active** (real
participants), **Idle** (genuinely empty), **Unknown** (the node didn't
answer). A dashboard that reported zero during a partition would tell an
operator every call had ended.

### Connections — pagination and realtime

The Connections page server-renders the first page (≤200 rows,
`ravenApi.listConnections`'s cursor pagination, `{data, nextCursor,
hasMore}`); **Load more** fetches subsequent pages client-side through the
BFF. A `connection.state_changed` WebSocket nudge triggers a debounced
(400ms) refetch of page one, merged in by upsert — never a raw replace,
so anything already loaded via Load More survives. See "Realtime" below
for the shared mechanics.

### Servers — the fleet

Deployment-level rather than project-scoped: an SFU node is shared
infrastructure, so there is no project whose membership could authorize
it. **Status is the only live column**; rooms, participants, CPU and
memory are each node's last heartbeat, shown beside the heartbeat age
rather than hidden in a details panel. A figure the node did not report
renders as `—`, never as `0`.

Draining is the one mutation in the RTC section
(`POST /api/rtc/servers/:name/drain`) — takes a node out of the
allocation pool **without** ending the calls on it. The target state is
sent explicitly rather than as a toggle, so two operators on stale pages
can't flip a node between pools by each clicking what they think is the
opposite action.

## Realtime

One `DashboardRealtimeProvider` (`lib/realtime/`), mounted once in
`AppShell`, owns the **one** Dashboard WebSocket connection for the
current project — every component that wants realtime
(`NotificationsBell`, `ConnectionsList`, `RoomsList`, `StreamsList`,
`StreamDetail`, `WebhooksManager`) calls the same `useDashboardRealtime`
hook, which detects the shared provider via context and subscribes to it
instead of opening a second connection. A component rendered without a
provider ancestor (every existing unit test) still opens its own —
the sharing is additive, not a behavior change for anything that isn't
under `AppShell`.

The connection itself:

- **Short-lived, signed, project-scoped token** — minted server-side
  (`POST /api/projects/:id/dashboard-ws-token`) after the same
  project-ownership check every other route makes; the browser never
  decides its own project scope.
- **Origin-validated** per project at the WebSocket upgrade — the one
  place CORS doesn't apply.
- **Reconnects with exponential backoff + jitter**, up to a bounded
  attempt count; a terminal rejection (bad/expired/revoked token,
  disallowed origin) shows one toast ("Live updates disconnected. Reload
  the page to reconnect.") and stops retrying rather than spinning
  forever.
- Every server frame is a **nudge, never data** — `{type: "..."}` telling
  a component to go refetch over REST, exactly per the "REST stays
  authoritative" model. No component ever renders a WebSocket payload's
  fields directly.

`lib/realtime/use-debounced-refetch.ts` is the shared 400ms
debounce-then-refetch hook every realtime list uses, so a burst of
backend events collapses into one REST call instead of one per event.

## Notifications

`NotificationsBell` (top-right of every project page) shows the caller's
own, project-scoped, persistent notifications — `GET
/v1/projects/:id/notifications` is the authoritative snapshot;
`notification.created` over the WebSocket is only the nudge to refetch it.
Unread count and list both update through the same debounced-refetch
mechanism as every other realtime surface. Mark-one and mark-all-read are
optimistic (the dot disappears immediately) and roll back if the request
fails. Switching projects tears down the old state before the new
project's fetch lands — no stale-project flash.

## Webhooks

**Project → Webhooks** creates, edits, disables and deletes endpoints, and
shows recent delivery attempts with their status. A `webhook.delivery_failed`
or `webhook.endpoint_disabled` nudge triggers the same debounced realtime
refetch as everywhere else. Delete requires a restated, in-place
confirmation (same `InlineConfirm` pattern as API keys and members).

**Known gap**: no replay or test-send from the dashboard. Retries are
automatic and exponential on the backend; once exhausted, that one
delivery is gone — there is no "send a test event" or "retry now" button.
See [webhooks](../apps/docs/content/webhooks.md) for the full delivery
contract (signing, retry schedule, event types).

## Live Streaming & Chat

Both are **inspection-only** in the dashboard — it never creates, starts,
updates, or ends a stream or a conversation; those are calls a developer's
own backend makes with the SDK. The dashboard shows what already exists,
the same way Rooms shows rooms nobody clicked "create" for in here.

- **Live Streaming** (`live-streaming/streams/`): status, hosts, peak/current
  viewer count, and (per-stream) chat activity metadata. `live_stream.started`/
  `live_stream.ended` nudges refresh the list and the one open detail page.
- **Chat** (`chat/conversations/`, `chat/connections/`): conversation and
  connection activity — counts, timestamps, connection state. Message
  **content** is never shown or fetched by the dashboard (spec-level
  privacy boundary): only metadata a conversation's own type/status/member
  count exposes.

## Usage

Every account gets a fixed grant of free RTC minutes, metered server-side
and enforced (`docs/usage-metering.md`) — `/dashboard/usage` (account-level)
and a project's own Usage tab show the allowance, history, and a
daily/by-project breakdown. Chat and Live Streaming have their own,
independent free-tier pools (messages sent; host-connected time) — using
one product never draws down another's balance. There is no plan, no
payment path, and nothing in the dashboard can change an allowance —
that's a Super Admin Portal action only, and it's logged.

## Observability

`connections/` and `errors/` under a project, backed by `GET
/v1/projects/:projectId/{connections,errors,metrics,diagnostics}`
(JWT-guarded, ownership-checked like every other dashboard route).

- **Connections** — overview stat cards (active rooms/participants,
  connection success rate, reconnection rate, average duration, errors)
  with a range selector, plus the paginated/realtime table described
  above. Clicking one opens its detail page: full metadata, any errors,
  and the complete event timeline.
- **Errors** — a table of classified errors (`TOKEN_ERROR`, `ICE_ERROR`,
  etc. — see `docs/error-codes.md`), each linking back to its connection.
  The detail page shows the message plus a hedged "likely cause"/
  "suggested action" explanation, never stated as certain.

Every number on these pages comes from the `Connection`/`ErrorEvent`
tables — a project with no real connections shows `0`/`—`, never a
placeholder percentage. There is no client-side ICE/browser diagnostic
view here — that data only exists inside a running `@ravenkash/rtc` client
(`room.getDiagnostics()`, `docs/diagnostics.md`), and the dashboard never
fabricates it.

## Infrastructure health

`GET /health` (unauthenticated, used by orchestrators) runs real probes
rather than reporting a configured value
(`apps/api/src/modules/health/dependency-checks.util.ts`):

- `checkSfuHttp` — a real HTTP request to a **registered** node's
  `/healthz`.
- `checkStunBinding` — a **real STUN Binding Request/Response** (RFC 5389)
  over UDP directly against coturn, not a simulated check.

`sfu: down` covers both "the node is not answering" and "no node has
registered" — the Overview page's Infrastructure card carries the fleet
line that says which. `Unknown`/`Down` are real, reachable states, never
hidden.

## SDK Quickstart

The Quickstart page's stack-aware integration wizard walks a developer
through language/framework-specific setup, verifies it against the real
project (`POST /v1/projects/:id/integrations/:product/verify`), and every
code example is cross-checked against `docs/sdk.md` and the actual public
SDK surface — no example uses an API that doesn't exist.

## Shared UI components & conventions

Rolled by hand rather than a headless-UI dependency (each is a few dozen
to ~150 lines, and this console needs exactly these three overlay
patterns, no more):

- **`components/ui/dialog.tsx`** — modal dialog: Escape closes, Tab/Shift+Tab
  cycle inside and never escape it, focus moves in on open and back to the
  trigger on close, body scroll locks. The exact same focus-trap contract
  (`components/ui/use-focus-trap.ts`) is shared with the mobile nav
  drawer in `AppShell`, so there's one implementation of "modal
  keyboard/focus behavior," not two.
- **`components/ui/menu.tsx`** — popover menu: Escape closes and returns
  focus to the trigger, arrow keys move a roving focus between items, an
  outside click or **tabbing past the last item** closes it (so the
  popover never sits open with focus already elsewhere on the page).
- **`components/ui/inline-confirm.tsx`** — the restate-before-it-fires
  guard every permanent one-click action (API key revoke/rotate, member
  remove, webhook delete) uses: replaces the trigger button in place with
  the consequence spelled out plus Cancel/Confirm, rather than a
  full-screen dialog for a one-line question next to data the person can
  already see.
- **`lib/client-fetch.ts`** — `readJson()`/`errorMessage()`, the shared
  client-side response-parsing pair every mutation UI uses instead of
  hand-rolling `fetch().then(r => r.json())` with ad hoc error extraction.
- One global `:focus-visible` ring (`app/globals.css`) is the app's only
  focus treatment — form controls and buttons never define their own.

## Security posture

- **XSS**: no `dangerouslySetInnerHTML` anywhere except one static,
  no-user-input theme-flash-prevention script in the root layout. Every
  user-supplied string renders through JSX text nodes.
- **CSRF**: mitigated via `SameSite=Lax` on the session cookie, which
  blocks it from being attached to a cross-site POST/PATCH/DELETE. No
  dedicated CSRF token exists — a known, accepted limitation, not an
  oversight.
- **Secret/session exposure**: the session JWT never reaches client JS
  except the one documented CLI-hand-off exception above. No
  `NEXT_PUBLIC_*` variable carries anything sensitive. No token/secret is
  ever written to `localStorage`/`sessionStorage` (only the theme
  preference is).
- **IDOR / cross-tenant isolation**: every project-scoped BFF route
  forwards the caller's session token and trusts the Control API's own
  `authorize()` check — never re-implements authorization client-side. A
  project/notification/resource that exists but isn't the caller's own
  returns 404, never a 403 that would confirm the ID is real.
- **Sensitive logging**: no `console.log`/`error` of tokens, secrets, or
  passwords anywhere in the dashboard's runtime code. Server-side BFF
  error logging (`handleApiError`) logs `requestId`/status/code/message
  only — the message is always the Control API's own already-sanitized
  string, never a raw exception.
- **Open redirect**: the post-login `?next=` parameter is validated
  (`safeInternalPath`) before being followed, matching the same guard the
  OAuth start/callback routes already used.
- **Client-side-only authorization**: none exists — `proxy.ts` and every
  frontend `capabilities`/role check are explicitly UX only, documented as
  such at each call site.

## Known limitations

- No webhook *replay or test-send* from the dashboard (see "Webhooks"
  above).
- No dedicated CSRF token — mitigated via `SameSite=Lax` cookies only.
- No billing/payment path — usage metering exists and is enforced, but an
  allowance can only be changed from the Super Admin Portal, never
  self-service.
- No client-side ICE/browser diagnostic view in Observability — that data
  only exists inside a running SDK client, never fabricated here.
- Live Streaming and Chat are inspection-only; the dashboard cannot create,
  start, or moderate either.
