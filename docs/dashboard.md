# Dashboard — `@raven/dashboard`

The developer dashboard is the control center for Raven's infrastructure:
create projects, manage API keys, inspect rooms and their live participants,
and read SDK integration instructions. It is **not** a video-conferencing
app — it never joins a call itself (the one exception, a disposable
smoke-test token, is explicitly scoped down and documented below).

## Architecture

```
Browser
   |
   v
Next.js dashboard (apps/dashboard)
   |  Server Components + Route Handlers only —
   |  the browser never calls the Control API directly.
   v
Raven Control API (apps/api)
   |
   +-- PostgreSQL (projects, api keys, rooms, RTC server registry)
   +-- Redis (rate limiting, JWT blocklist)
   +-- Raven SFU fleet, over the node link (live room/participant state)
   +-- coturn (via the same RTC-token minting path)
```

`apps/dashboard/src/lib/api-client.ts` is the **only** file that knows the
Control API's base URL and constructs requests to it — every server
component/route handler goes through it, and it is never imported at
runtime from a `'use client'` component (only its exported *types* are,
which are erased entirely at build time — verified in the security audit
below).

## Authentication

The dashboard reuses the Control API's existing JWT session auth
(`POST /v1/auth/{register,login,logout}`) — it does not implement its own
user store. The session JWT is held in an **httpOnly, `SameSite=Lax`**
cookie (`raven_session`), set by the dashboard's own Route Handlers
(`app/api/auth/{login,register}/route.ts`) after calling the Control API;
`app/api/auth/logout/route.ts` blocklists it server-side and clears the
cookie. No client component or client-side JavaScript ever reads the raw
token — `lib/session.ts`'s `getSessionToken()` is server-only
(`next/headers`'s `cookies()`), confirmed by grepping every `'use client'`
file in the codebase for that import.

`src/proxy.ts` (Next.js's post-15 renaming of `middleware.ts` — the export
had to be renamed from `middleware` to `proxy` to match) redirects to
`/login` when the session cookie is absent, for every `/dashboard/**`
route. **This is a UX convenience only, not the authorization boundary** —
see below.

## Authorization

Every dashboard page/action calls the Control API with the session JWT,
and the API is what actually authorizes it:

- `JwtAuthGuard` confirms the token is valid and unexpired.
- Every project-scoped lookup (`ProjectsService.findOneForOwner`,
  and the new `DashboardRoomsController`/`DashboardRtcTokensController`,
  which call it explicitly before touching a room) is scoped to
  `ownerId = <the authenticated user>`. A project that exists but belongs
  to someone else returns the *same* 404 as a project that doesn't exist
  at all — never a 403, which would confirm the ID is real.

This was verified live, not just by code inspection: a second registered
user, given the first user's real project ID, gets `Project not found` on
every one of `/dashboard/projects/:id/overview`,
`GET /api/projects/:id/rooms`, and `POST /api/projects/:id/rooms/:id/test-token`
— confirmed via direct fetch calls in a real browser session, not just unit
tests.

**`proxy.ts`'s cookie-presence check is never the source of truth for
"can this user see this data"** — bypassing it entirely would only ever
produce a 401/404 from the API, never someone else's data.

## Projects

`POST /v1/projects` (Control API) generates the project ID server-side —
the dashboard never lets a developer choose one. `GET /v1/projects` lists
only the caller's own non-archived projects.

## API Keys

`apps/dashboard` adds no new API-key logic — it is a thin UI over the
existing Phase 2 endpoints (`POST/GET /v1/projects/:id/api-keys`,
`DELETE /v1/projects/:id/api-keys/:keyId`). The full secret
(`publicId.secret`) is rendered **exactly once**, immediately after
creation, from the API's own one-time response — the dashboard never
stores it, never re-fetches it, and the list endpoint's response shape
(`ApiKeySummary`) has no field capable of holding it (enforced by
`apps/api`'s own Prisma `select` clause, not just the frontend type).

There is currently one key type (no separate development/production
distinction) — kept deliberately simple per the phase spec's "do not
create excessive key types" guidance.

## RTC configuration & the token model

The dashboard explicitly documents (Quickstart page) and enforces
(no UI path exists to do otherwise) the required flow:

```
API Key → Developer Backend → Control API → short-lived RTC Token → Developer Browser → RTC infrastructure
```

The dashboard **cannot** and does not mint long-lived participant tokens
for normal use. The one exception is a **10-minute, fixed-permission
"test token"** (`POST /v1/projects/:projectId/rooms/:roomId/test-token`,
new in this phase, `DashboardRtcTokensController`) that lets a developer
smoke-test a room from the dashboard itself, authenticated by the
developer's own session JWT rather than a project API key. It is clearly
labeled in the UI as being for smoke-testing only, is not
developer-configurable (TTL and permissions are hardcoded), and is
functionally identical to what a real backend would request via the normal
API-key-guarded endpoint — it does not introduce a second, weaker token
model.

## The RTC section

Five tabs, in the order you reach for them (spec §29). The first three
answer "what are my users doing"; the last two answer "is the media plane
itself healthy".

| Tab | Page | Backed by |
|---|---|---|
| Rooms | `rooms/`, `rooms/[roomId]/` | `GET /v1/projects/:id/rooms` |
| Connections | `connections/`, `connections/[connectionId]/` | Telemetry-sourced `Connection` history |
| Participants | `participants/` | Live state across the project's rooms |
| Servers | `servers/` | `GET /v1/rtc/servers` — **not** project-scoped |
| Diagnostics | `diagnostics/` | Live dependency probes |

### Rooms — real live state, not fake metrics

The `Room` Postgres row is a control-plane record only — it has no idea
whether anyone is actually connected. `SfuRoomStateService`
(`apps/api/src/modules/rooms/sfu-room-state.service.ts`) asks the room's
assigned SFU node over the node link:

- `listLiveParticipantCounts(roomIds)` → real counts per room. A room
  whose node did not answer is **absent from the map**, and the whole
  result is `undefined` when nothing answered at all — rendered as
  "Unknown", never silently as `0`.
- `listLiveParticipants(roomId)` → real participants with identity, join
  time, and published tracks (kind + mute state). `[]` for a room with no
  assigned node, which is a genuinely idle room; `undefined` when the node
  could not be reached.

That three-way distinction — serving, idle, unknown — is the point, and it
survives all the way to the badge: `Active`, `Idle`, `Unknown`. A
dashboard that reported zero during a partition would tell an operator
every call had ended.

`DashboardRoomsController` (JWT-guarded, project-ownership-checked) is
what these pages call — distinct from `RoomsController` (API-key-guarded,
for a developer's own backend).

### Servers — the fleet

Deployment-level rather than project-scoped, and deliberately so: an SFU
node is shared infrastructure, so there is no project whose membership
could authorize it. It exposes only node identity, health and aggregate
load — never anything about another project's rooms — which is why any
authenticated developer of this deployment can see it.

The page is honest about what its numbers are. **Status is the only live
column**; rooms, participants, CPU and memory are each node's last
heartbeat, which is why the heartbeat age sits beside them rather than in
a details panel. A figure the node did not report renders as `—`, never as
`0`. Nodes are not provisioned here or anywhere — they register themselves
on boot.

Draining is the one mutation in the RTC section, via
`POST /api/rtc/servers/:name/drain`. It takes a node out of the allocation
pool **without** ending the calls on it, which is exactly what you want
mid-incident. The target state is sent explicitly rather than as a toggle,
so two operators on stale pages cannot flip a node between pools by each
clicking what they think is the opposite action. `raven rtc servers drain`
does the same thing from a terminal.

The Overview page's Infrastructure card carries one extra line from the
same source, because `SFU: up` cannot answer the question a developer
actually has when calls fail: a probed node can answer while every node is
draining, and then no room can be allocated at all. The line says which,
and links here.

## Usage

No usage-metering or billing system exists yet (Phase 8/17 in
`.docs/INFRASTRUCTURE_PHASES.md` are unbuilt). The Usage page shows only
what is genuinely computable today — total room count, current live
participant count — and explicitly lists what is **not yet available**
(participant-minutes, TURN bandwidth, historical aggregation) rather than
inventing numbers, per the phase spec's explicit instruction.

## Observability (Phase 9)

Three new tabs, `apps/dashboard/src/app/dashboard/projects/[projectId]/{connections,errors}/`,
backed entirely by the new `GET /v1/projects/:projectId/{connections,errors,metrics,diagnostics}`
endpoints (JWT-guarded, ownership-checked like every other dashboard
route) — full data model and architecture in `docs/observability.md`.

- **Connections** — overview stat cards (active rooms/participants,
  connection success rate, reconnection rate, average duration, errors)
  with a 15-minute/1-hour/24-hour/7-day range selector, plus a table of
  real connections. Clicking one opens its detail page: full metadata,
  any errors, and the complete event timeline.
- **Errors** — a table of classified errors (`TOKEN_ERROR`, `ICE_ERROR`,
  etc. — see `docs/error-codes.md`), each linking back to its connection.
  The detail page shows the message plus a hedged "likely cause"/
  "suggested action" explanation, never stated as certain.

Every number on these pages comes from the `Connection`/`ErrorEvent`
tables — a project with no real connections shows `0`/`—`, never a
placeholder percentage (same "no fake metrics" rule as the Usage page
above). There is no client-side ICE/browser diagnostic view here — that
data only exists inside a running `@corvidhq/rtc` client
(`room.getDiagnostics()`, `docs/diagnostics.md`), and the dashboard
never fabricates it.

## Infrastructure health

`GET /health` (unauthenticated, used by orchestrators) runs real probes
rather than reporting a configured value
(`apps/api/src/modules/health/dependency-checks.util.ts`):

- `checkSfuHttp` — a real HTTP request to a **registered** node's
  `/healthz`. `/healthz` and not `/readyz`: readiness on a node reports
  whether it can accept new participants, which depends on its
  control-plane link — asking that *from* the control plane would make the
  answer partly about the question.
- `checkStunBinding` — a **real STUN Binding Request/Response** (RFC 5389)
  over UDP directly against coturn, not a simulated check. Validates the
  response's magic cookie and transaction ID, guarding against a stray or
  spoofed UDP packet being misread as success.

The SFU check depends on the registry rather than on configuration, which
is a real change in what it means: there is no address to probe until a
node has registered itself. `sfu: down` therefore covers both "the node
is not answering" and "no node has registered", and the fleet line on the
Overview page exists to say which. Both probes run from inside the api
container's own network context, over each node's `internalUrl` and
`TURN_INTERNAL_HOST` — distinct from the client-facing addresses, the same
internal-vs-external split used everywhere else. `Unknown`/`Down` are real,
reachable states, never hidden.

## SDK Quickstart

Every code example on the Quickstart page was cross-checked line-by-line
against `docs/sdk.md` and the actual `@corvidhq/rtc` public API
(`createRTCClient`, `client.join`, `room.enableCamera`/`enableMicrophone`,
`room.on('participantJoined'|'trackSubscribed', ...)`, `room.leave`) — no
example uses an API that doesn't exist. Backend/frontend steps are
visually separated so a developer can't confuse where each snippet runs.

## Security audit (performed this phase)

- **XSS**: `dangerouslySetInnerHTML` — zero occurrences anywhere in
  `apps/dashboard/src`. All user-supplied strings (project name, key name,
  room name, participant identity) render through JSX text nodes only.
- **CSRF**: session cookie is `SameSite=Lax`, which blocks it from being
  attached to cross-site POST/PATCH/DELETE requests (the dashboard's own
  mutating routes) — a lighter-weight mitigation than a dedicated CSRF
  token, considered sufficient for this phase and documented as a known
  limitation below.
- **Secret/session exposure**: verified, not just asserted — grepped the
  actual **built** `.next/static/chunks/*.js` output for the Control API's
  internal URL and for any `rvk_`/JWT-shaped string; found none. Every
  file importing `lib/api-client.ts` from a `'use client'` component does
  so via `import type` only (fully erased at compile time).
- **IDOR / cross-tenant isolation**: verified live with a second real
  registered user attempting to reach the first user's project, rooms
  list, room detail, and test-token endpoint — all four returned 404.
- **Sensitive logging**: no `console.log`/`error` of tokens, secrets, or
  passwords anywhere in the dashboard's actual runtime code (one
  `console.log` match is inside a Quickstart code-sample *string*, shown to
  the developer as documentation — not executed dashboard code).
- **Client-side-only authorization**: none exists — `proxy.ts` is
  explicitly a UX redirect, documented in its own source comment as not
  the authorization boundary.

## Known limitations

- No per-project CORS/allowed-origins configuration — one `CORS_ORIGIN`
  applies to the whole Control API deployment. The Settings page states
  this honestly rather than presenting a non-functional per-project UI.
- No webhook infrastructure exists — the Settings page shows "Coming
  soon," not a fake configuration form.
- No organization/team model — project ownership is a single owner per
  project, matching the existing Phase 2 data model exactly (no new
  permission tiers were invented).
- No dedicated CSRF token — mitigated via `SameSite=Lax` cookies only.
- Usage metering/billing do not exist yet — the Usage page is intentionally
  minimal and says so.
