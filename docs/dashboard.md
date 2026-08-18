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
   +-- PostgreSQL (projects, api keys, rooms)
   +-- Redis (rate limiting, JWT blocklist)
   +-- LiveKit RoomServiceClient (live room/participant state)
   +-- coturn (via the same RTC-token minting path as Phase 4/5)
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

## Rooms — real live state, not fake metrics

The pre-existing `Room` Postgres row is a control-plane record only — it
has no idea whether anyone is actually connected. This phase adds
`LiveKitRoomService` (`apps/api/src/modules/rooms/livekit-room.service.ts`),
which wraps `livekit-server-sdk`'s `RoomServiceClient` to answer "what's
actually happening in the SFU right now":

- `listLiveParticipantCounts(names)` → real participant counts per room, or
  `undefined` if LiveKit is unreachable (a rooms list with `null` per room
  is rendered as "Unknown", never silently as `0`).
- `listLiveParticipants(name)` → real participants with their identity,
  join time, and published tracks (kind + mute state), or `undefined` on
  the same unreachable-vs-empty distinction.

`RoomsService.findAllForProjectWithLiveState` /
`findOneForProjectWithLiveState` combine the two sources.
`DashboardRoomsController` (JWT-guarded, project-ownership-checked) is
what the dashboard's Rooms/Room-detail pages actually call — distinct from
the pre-existing `RoomsController` (API-key-guarded, for a developer's own
backend).

This was proven live, not just asserted: two real browser tabs joined a
real room via `@raven/rtc` (using dashboard-issued test tokens), and the
Room detail page immediately showed both real participants with real
join timestamps and real `audio`/`video` track badges — sourced from
LiveKit, not fabricated.

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
data only exists inside a running `@raven/rtc` client
(`room.getDiagnostics()`, `docs/diagnostics.md`), and the dashboard
never fabricates it.

## Infrastructure health

`GET /health` (unauthenticated, used by orchestrators) was extended this
phase with real LiveKit and coturn checks
(`apps/api/src/modules/health/dependency-checks.util.ts`):

- `checkLiveKitHttp` — a real HTTP request to LiveKit's own port.
- `checkStunBinding` — a **real STUN Binding Request/Response** (RFC 5389)
  over UDP directly against coturn, not a simulated check. Validates the
  response's magic cookie and transaction ID, guarding against a stray/
  spoofed UDP packet being misread as success.

Both checks run from inside the api container's own network context, which
required introducing `LIVEKIT_INTERNAL_URL`/`TURN_INTERNAL_HOST` config —
distinct from the client-facing `LIVEKIT_URL`/`TURN_HOST`, the same
internal-vs-external split already established for those values in
earlier phases. The Overview page's "Infrastructure health" card renders
this data directly — `Unknown`/`Down` are real, reachable states, not
hidden.

## SDK Quickstart

Every code example on the Quickstart page was cross-checked line-by-line
against `docs/sdk.md` and the actual `@raven/rtc` public API
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
