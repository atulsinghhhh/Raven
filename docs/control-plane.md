# Control Plane (Phase 2)

This document covers the backend built in Phase 2 of `INFRASTRUCTURE_PHASES.md`:
a TypeScript/NestJS modular monolith (`apps/api`) that manages developers,
projects, API keys, rooms, and RTC tokens. **It never carries video/audio
media** — that is the RTC plane's job (Raven's own SFU + coturn, see
`docs/rtc/`), and stays that way permanently. See `docs/architecture/infrastructure-decisions.md`.

## Why NestJS + Prisma

Phase 0 committed to TypeScript/Node.js but left the specific framework
open. NestJS was chosen for Phase 2 because its module system maps
directly onto the module boundaries this phase already needed
(`auth`, `users`, `projects`, `api-keys`, `rooms`, `rtc-tokens`, `health`),
its DI container makes those boundaries real (a module only sees what
another module explicitly exports), and it gives request validation
(class-validator), guards, and exception filters as first-class primitives
instead of hand-rolled middleware. Prisma was chosen for the ORM/migration
layer for its type-safe client and straightforward migration workflow —
both fit the "modular monolith, not microservices" instruction (Rule 3)
without locking in a data-access pattern that's hard to split apart later.

## Two authentication models

This is the most important design decision in Phase 2 to understand
before touching the code — mixing these up is the easiest way to build a
security hole.

1. **JWT (developer session auth)** — `JwtAuthGuard`. Used for
   dashboard-style management: `/v1/auth/*`, `/v1/projects/*`,
   `/v1/projects/:id/api-keys/*`. A developer registers/logs in with
   email+password and gets a bearer JWT. Every one of these routes scopes
   its query to `ownerId = <the authenticated user>` — see
   `projects.service.ts#findOneForOwner`.
2. **API key (machine auth)** — `ApiKeyAuthGuard`. Used for the endpoints
   a developer's *own backend* calls at runtime: `/v1/rooms/*` and
   `/v1/rooms/:roomId/rtc-tokens`. The caller sends
   `Authorization: Bearer <publicId>.<secret>`; the guard resolves that to
   a project and attaches it to the request. Every room/token operation is
   scoped to that resolved `projectId`.

A developer JWT can manage projects and API keys but cannot create rooms
or mint RTC tokens directly — that requires an API key, mirroring how
Stripe's dashboard session and secret API keys are deliberately different
credentials with different blast radii.

### A note on the RTC token endpoint's exact shape

The RTC token endpoint is `POST /v1/rooms/:roomId/rtc-tokens` (matching the
`rtc-tokens` module directory) with a `participantIdentity` field, rather
than the `POST /v1/rooms/:roomId/tokens` + `participantId` shape sketched
as a conceptual example partway through Phase 2's brief. This was a
deliberate consistency choice, not an oversight: the brief itself said to
follow the project's existing architecture, and by the time that example
was given, the `rtc-tokens` module, its controller, tests, and this
document already existed under that name. Renaming at that point would
have been churn for its own sake with no functional benefit.

## Cross-tenant isolation

Every "find one" lookup in every service (`ProjectsService`,
`ApiKeysService`, `RoomsService`, `RtcTokensService`) filters by the
resource's owning ID (`ownerId` or `projectId`) in the same query that
finds it, and returns the **same `NotFoundError`** whether the resource
doesn't exist or belongs to someone else. A `403 Forbidden` would confirm
the resource ID is real and just not yours — that's an information leak
about another tenant's account, so it's deliberately avoided everywhere.
This is covered by dedicated tests in `projects.service.spec.ts`,
`rooms.service.spec.ts`, and the e2e cross-project test in
`test/app.e2e-spec.ts`.

## API keys: the show-once secret

An API key's raw secret is never stored — only a bcrypt hash of it
(`api-keys.service.ts`). The row also stores a `publicId` (e.g.
`rvk_TugSAioScTjb`), which exists purely so the server can find the right
row *before* doing an expensive bcrypt comparison — you cannot index a
bcrypt hash for equality lookup by secret, since it's salted. The full key
handed to the developer is `publicId.secret`; only `publicId` shows up
again afterward (e.g. in `GET /v1/projects/:id/api-keys`). If it's lost,
the only option is revoking it and creating a new one — this is
intentional and documented back to the developer in the creation
response's `warning` field.

On top of bcrypt's own per-key salt, the secret is also run through an
HMAC-SHA256 **pepper** (`API_KEY_HASH_SECRET`) before hashing
(`crypto.util.ts#pepper`). The difference matters: a salt lives *in the
database*, alongside the hash it protects — if the database leaks, the
salt leaks with it. A pepper lives only in environment/secret config, so a
database-only compromise (a dump, a backup left somewhere public) isn't
enough by itself to offline-brute-force key secrets; the attacker would
also need the pepper. HMAC (not string concatenation) is used specifically
to produce a fixed 32-byte output regardless of pepper length, avoiding
bcrypt's 72-byte input truncation footgun.

## RTC tokens: Raven's permissions

`POST /v1/rooms/:roomId/rtc-tokens` accepts Raven's own permission
vocabulary (`join`, `subscribe`, `publish`, `publishAudio`, `publishVideo`,
`publishData` — see `INFRASTRUCTURE_PHASES.md` Phase 2 spec). There is no
translation step: those flags are signed straight into the token as
`perms` and re-checked by the signaling gateway on every action.

That used to be a mapping onto a third party's grant shape, and keeping
Raven's names independent of it is what let the media plane be replaced
without touching this contract. The indirection paid for itself, so it is
kept: the SFU has its own `room.Permissions` type rather than reusing this
DTO, and a change to either can happen without the other.

Two behaviours are load-bearing and preserved from that mapping
(`rtc-token.claims.ts`, `resolvePermissions`):

- **Anything unset is denied, never granted.** Every flag is written
  explicitly, because a token whose absent field means "allow" turns a
  serialization bug into a privilege escalation.
- **`publish: true` with neither `publishAudio` nor `publishVideo` means
  both.** "Let them publish, I don't care what" is what a caller who omits
  the sub-flags is asking for; naming one of them is what narrows it.

Each call also creates a `Participant` row (upserted by `roomId` +
`identity`) and an `RtcToken` row — these are the control-plane's audit
trail, not the credential itself. The `RtcToken` row is created **first**,
because its `id` is the token's `jti`; a token cannot claim an audit-trail
id that does not exist yet. The bearer credential (a Raven-signed HS256
JWT with `aud: "raven-rtc"`) is generated fresh every call and never
persisted; recovering a lost one isn't possible or necessary, since tokens
are short-lived (`RTC_TOKEN_DEFAULT_TTL_SECONDS`, default 600s) and just
get re-minted.

Since Phase 4, the response also includes `iceServers` — STUN and
short-lived TURN credentials for the same coturn deployment from Phase 1,
scoped to this participant and this token's TTL. See
`docs/rtc/networking.md` for the credential scheme and
`docs/rtc/architecture.md` for how a client uses this alongside `token` to
actually establish media.

## Data model

See `apps/api/prisma/schema.prisma` for the authoritative definitions.
Notable choices not obvious from the field list alone:

- **`Project.status` / `Room.status` are soft-delete flags**
  (`ARCHIVED` / `CLOSED`), not hard deletes. Both resources own children
  (API keys, rooms, participants, usage/audit history in later phases)
  that stay valuable after "deletion" — plan.md explicitly calls for audit
  logs, and hard-deleting a project would silently destroy that trail.
- **`Room` uniqueness is `(projectId, name)`, not just `name`** — this is
  what lets two unrelated developers both create a room called `"lobby"`
  in their own projects without conflict, satisfying the "design the
  schema so multiple projects can safely coexist" requirement.
- **`Participant` is a control-plane concept, not a live session
  record** — who is actually connected right now is read from the room's
  assigned SFU node (`SfuRoomStateService`), never from this table, and
  the two can legitimately disagree. This row exists so `RtcToken` has
  something durable to reference and so a room enforces one consistent
  identity per participant (`@@unique([roomId, identity])`).

## Database migrations

Prisma migrations live in `apps/api/prisma/migrations/`. Locally:

```bash
cd apps/api
pnpm prisma:migrate:dev --name <description>   # create + apply a new migration
pnpm prisma:generate                            # regenerate the client after schema changes
pnpm prisma:studio                              # browse the database
```

In Docker, a one-shot `migrate` service runs `prisma migrate deploy`
(apply-only, never generates new migrations) and the `api` container waits
for it to finish — so `pnpm infra:up` still needs no manual migrate step.
The API image itself does not migrate: production scales it to N
instances, and N of them migrating at once through a transaction pooler
contend for one advisory lock. See `docker-compose.yml`'s `migrate`
service and `docs/deployment/managed-postgres.md#applying-migrations`.

## Rate limiting

`RateLimitGuard` (`shared/rate-limit/`) is a fixed-window counter in Redis
(`INCR` + `EXPIRE`-on-first-hit), applied via a `@RateLimit(n)` decorator
to five endpoints: registration (5/window), login (10/window), API key
creation (20/window), RTC token creation (60/window), and telemetry
ingest (600/window). Window size is `RATE_LIMIT_WINDOW_SECONDS` (default
60s), shared globally rather than per-route.

The budget is keyed by the most specific identity a request actually
carries, checked in this order:

1. **API key public id**, when `ApiKeyAuthGuard` authenticated the
   request. Keyed on the key itself rather than its project, so two keys
   on one project don't share a budget — a noisy or compromised key
   cannot spend its sibling's headroom, and each key is independently
   revocable for exactly this kind of isolation.
2. **JWT user id**, when `JwtAuthGuard`/passport set `request.user`.
3. **Client IP**, only when neither exists — the pre-auth routes
   (login, register) have no identity to key on yet.

IP-only keying (the previous design) has two concrete failure modes:
every legitimate user behind one corporate NAT shares a single bucket,
and an authenticated abuser can evade any limit meant to cap them just by
rotating IPs. Keying on identity when one is available fixes both, since
the budget follows the actor rather than their network path. Identity is
never combined with IP — an authenticated abuser rotating IPs is still
one identity and should stay capped as one.

A refusal returns `429` with `RAVEN_RATE_LIMITED` and `retryAfterSeconds`
read from the key's actual Redis TTL, so a client knows when to retry
rather than merely being told to stop. See docs/error-codes.md. The
message stays generic — no indication of the limit's exact value or
remaining budget, which would help an attacker tune around it.

This is deliberately not a distributed, per-tenant rate-limiting platform
(no sliding windows, no burst/leaky-bucket, no per-user-plan tiers) — it's
enough to blunt credential stuffing, brute force, and spam signups. It
does not yet compose multiple dimensions (e.g. project *and* user) or
offer per-role tiers; revisit if real abuse patterns demand more.

Chat's `ChatRateLimitService` and signaling's `ConnectionRateLimitService`
are separate, purpose-built limiters and are not affected by any of the
above:

- Chat is already keyed per-subject (`projectId` + `userId`/`tokenId`) —
  it never had the IP-only problem, since a chat token always carries an
  identity by the time a rate-limited action happens.
- Signaling's WebSocket-upgrade limiter is IP-only by necessity: it
  guards the connection attempt itself, before any token is verified, the
  same situation as login and register above.

## CORS

Configured via `CORS_ORIGIN` (`main.ts`): a comma-separated allow-list of
browser origins, or `*` for local development. `*` is the `.env.example`
default *for local dev only* — every deployed environment must set an
explicit origin list. Since Raven's auth model uses bearer tokens in an
`Authorization` header (never cookies), an open CORS policy doesn't carry
the CSRF risk it would for a cookie-authenticated API, but it still allows
any website to read response bodies via `fetch`, which is reason enough to
lock it down outside local dev.

## API documentation

Interactive OpenAPI/Swagger docs are generated from the same decorators
that drive request validation (`@nestjs/swagger`) and served at `/docs`
(raw spec at `/docs-json`) — no separately maintained documentation to
drift out of sync with the actual DTOs. Every endpoint has a summary,
description, and response examples; `jwt` and `apiKey` are modeled as two
distinct bearer auth schemes matching the two guards described above, so
"Authorize" in the Swagger UI correctly reflects which credential each
endpoint expects.

## Health endpoint

`GET /health` reports `{ status: "ok" | "degraded", dependencies: { database, redis } }`
with a `503` status code when degraded. It deliberately reports only
up/down per dependency — no connection strings, hostnames, versions, or
error text — since this endpoint is commonly unauthenticated and must
never become a source of infrastructure reconnaissance.

## Testing

Root-level shortcuts: `pnpm test` (unit), `pnpm test:e2e` (e2e), `pnpm dev`
(hot-reload API on the host), `pnpm db:migrate` (create + apply a
migration), `pnpm db:seed` (seed a demo developer/project/key/room).

- **Unit** (30 tests): permission-mapping logic, password hashing, API
  key verification (including that the pepper is actually load-bearing,
  not decorative), and ownership/cross-project guard logic — all with
  mocked Prisma/Redis, no infrastructure required.
- **E2E** (24 tests, real Nest app against the real Phase 1
  Postgres/Redis — `docker compose up -d` must be running first):
  - The full golden path: register → duplicate-email rejected → login →
    wrong-password rejected → create project → create API key (secret
    shown once, never again) → create room via the key → mint an RTC
    token with the requested grant → token's `ttlSeconds` matches both
    the response and the actual JWT `exp` claim → an out-of-range
    `ttlSeconds` is rejected (no permanent tokens) → close the room →
    archive the project → logout invalidates the JWT immediately.
  - **Resource-level authorization boundaries**, exercising every hop of
    User → owns Project → owns Room → can create/manage RTC tokens: an
    intruder cannot read, modify, or delete another developer's project;
    cannot list, create, or revoke API keys under it; and a *different
    project's own valid API key* cannot read, close, or mint tokens for
    a room it doesn't own.
  - **Rate limiting**: repeated login attempts from the same client
    eventually receive `429`.

## What's still deferred

Per `INFRASTRUCTURE_PHASES.md`, Phase 2 stops here. WebSocket signaling
(`docs/rtc/signaling.md`) and the media plane (`docs/rtc/sfu.md`) are now
built. Still not built: the TypeScript SDK
(Phase 6), the dashboard (Phase 7), real usage metering (Phase 8),
recording (Phase 9), and everything from Phase 10 onward.
