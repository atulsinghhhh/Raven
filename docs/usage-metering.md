# Usage Metering (free tier)

Every registered developer is granted a fixed allowance of Livqeno minutes —
20,000 by default — and every RTC participant-session spends against it.
This document is the design: what is stored, who writes it, why it cannot
be double-counted, and what is deliberately not here.

The developer-facing version is `apps/docs/content/concepts/usage.md`.
This one is for whoever changes the code.

## Scope

**In:** RTC participant-minutes, metered server-side; a per-developer
entitlement; read APIs; the dashboard surface; enforcement at token mint
and at room join.

**Out, on purpose:** an admin portal, admin roles, admin authentication,
billing, plans, subscriptions, promotional credits, and manual quota
adjustment. None of those exist as code, config, endpoint or schema. §
[What this phase does not include](#what-this-phase-does-not-include)
covers what a future phase would add and why it does not need a schema
rewrite to do it.

## The data model

Two tables (`apps/api/prisma/schema.prisma`), and the split is the design.

### `usage_allowances` — the entitlement

One row per developer (`userId` unique).

| Column | Why it exists |
|---|---|
| `includedMinutes` | What **this** account was granted, snapshotted at provisioning. Not a constant the API re-reads: lowering `USAGE_FREE_TIER_MINUTES` later must not take minutes off anyone who already has them, and raising it must not retroactively grant them. |
| `consumedSeconds` | The running total, denormalised from `usage_sessions`. Seconds, not minutes — rounding at write time would let a developer accumulate unlimited sub-minute sessions for free. |
| `exhaustedAt` | When consumption first reached the granted minutes. Stamped once, never cleared. |
| `source` | `FREE_TIER` today. An enum rather than a boolean so `ADMIN_GRANT` or `PLAN` is an additive migration on a column the reading code already switches on. |

`consumedSeconds` is denormalised because enforcement reads it on the join
path, where a `SUM()` over a developer's whole session history is the wrong
query to run. It is updated in the same transaction that advances the
session which produced it, so the two cannot drift — and there is an e2e
test that asserts exactly that (`keeps the allowance counter equal to the
sum of its sessions`).

### `usage_sessions` — the meter, and the history

One row per RTC participant-session. This is also the usage history the
dashboard lists: the allowance counter is a sum of exactly these rows.

| Column | Why it exists |
|---|---|
| `sessionKey` | The signaling connection id — `randomUUID()` in `SignalingGateway.handleConnection`. Unique, which is what makes `startSession` idempotent under a retried join. |
| `meteredSeconds` | High-water mark of how much of this session has already been credited. The whole no-double-count argument rests on it. |
| `lastMeteredAt` | Last instant the session was confirmed alive *and* settled. Used twice: to find sessions whose gateway died, and as the instant to credit them up to. |
| `endedAt` / `closeReason` | Null while live. `left`, `abandoned` or `shutdown` — see `usage.constants.ts`. |
| `kind` | `RTC_PARTICIPANT_MINUTES`. An enum so a future kind is a migration that forces every aggregation to be revisited, rather than a string someone can typo. |
| `userId`, `projectId`, `environment`, `roomName`, `participantIdentity` | Denormalised attribution, so history stays queryable and readable independently of the allowance model. |

### Why not `Connection`?

`Connection` (the observability table) already records RTC sessions with
durations. It is the wrong source for metering, and the reason is
requirement-shaped rather than aesthetic: `Connection` is event-sourced
from telemetry the **client SDK POSTs**, fire-and-forget and unordered. A
developer could halve their own usage by dropping a `disconnected` event.

`usage_sessions` is written only by the signaling plane, from the server's
own clock and its own identifiers. The dashboard says so, because the two
numbers will not match and a developer reconciling them deserves to know
which is authoritative.

## Attribution: the project owner's minutes

A project's sessions spend the allowance of the account that **owns** the
project — whoever is in the room, whoever minted the token.

The alternative (charge each member their own minutes) makes a shared
project's usage unpredictable: the same call costs different accounts
different amounts depending on who happened to join. The project usage page
states explicitly when you are reading a project you do not own, rather
than presenting someone else's meter as yours.

## Provisioning

`UsageAllowanceService.ensureProvisioned` — an upsert with an **empty
update**, exactly like `OnboardingService.ensureStarted`. The empty update
is the important half: this is called on every read, and it must not reset a
spent allowance or resize an existing one.

Called from three overlapping places, deliberately:

1. `AuthService.register` — a fresh password account has its row immediately.
2. `OAuthService.findOrCreateUser` — both branches, so a first GitHub/Google
   sign-in provisions, and an existing account that predates metering is
   backfilled.
3. Every read and every meter open — so a seed-script account, or one that
   slipped past the above, is provisioned the first time it matters rather
   than reading as "0 of 0 minutes".

The migration also backfills every account that predates the feature. It
writes `20000` literally: a migration must reproduce itself identically on
every database forever, so it cannot read a configuration value that may
legitimately have changed by the time it runs.

## Why it cannot double-count

`UsageMeterService.settleRow` is the single write path. Consumption is
always `settlementInstant - startedAt`, never an increment of an unknown
prior value:

1. read the session's current `meteredSeconds`
2. `delta = elapsed - meteredSeconds`; stop if `delta <= 0`
3. move `meteredSeconds` to `elapsed` with a **compare-and-swap** on the
   value read in (1) — `updateMany({ where: { id, meteredSeconds: <read> } })`
4. add exactly that `delta` to the allowance, **in the same transaction** as (3)

Step 3 is what makes it safe. Two settlements of the same session that both
read before either writes both compute a delta, but only one CAS matches;
the loser adds nothing and returns `null`. Nothing is lost by losing,
because the winner already credited up to *its* instant and the next
settlement recomputes from `startedAt` regardless.

Concurrent settlements of *different* sessions sharing one allowance
serialize on the allowance row inside Postgres: the increment is
`consumed_seconds = consumed_seconds + $1` in SQL (Prisma's `increment`),
not a read-modify-write in Node. The e2e suite settles twenty parallel
sessions and asserts the total is exactly `20 × 60`.

Closing is separate from crediting, and conditional on `endedAt IS NULL`,
so the first close wins and a duplicate leave changes nothing. This matters
on the real path: `SignalingGateway.handleDisconnect` routes `ROOM_LEAVE`,
so an explicit `room.leave` followed by the socket closing settles the same
session twice.

`exhaustedAt` is stamped with `updateMany({ where: { exhaustedAt: null } })`,
so it records the first crossing and is never rewritten.

## Reliability: sweep, then reap

Metering only at leave-time would lose every session whose instance died
mid-call. So there are three writers:

| Trigger | Where | Credits up to |
|---|---|---|
| Join | `MessageRouterService.handleJoin` | — (opens the meter) |
| Periodic sweep, per instance | `SignalingGateway.runUsageSweep`, every `USAGE_METER_INTERVAL_MS` | now |
| Leave | `MessageRouterService.handleLeave` | now, and closes |
| Clean shutdown | `SignalingGateway.onModuleDestroy` | now, and closes |
| Reaper | `UsageMeterService.reap`, every `USAGE_REAPER_INTERVAL_MS` | **`lastMeteredAt`**, and closes |

Two details that are easy to get wrong:

**The sweep only settles sessions the instance is actually holding.** It
takes `sessionKey`s from the gateway's local socket map rather than querying
for live rows. Query for "all live sessions" instead and every instance
would happily keep metering the sessions of an instance that had crashed —
which is exactly the usage the reaper exists to bound honestly.

**The reaper credits to `lastMeteredAt`, not to now.** The participant
stopped when the gateway died. Crediting an abandoned session all the way
to the moment the reaper noticed would charge a developer for a Livqeno
outage. The dashboard shows those sessions as `Abandoned` rather than
folding them into "ended".

Both the sweep and the reaper are `setInterval`, following
`RetentionService`'s precedent rather than adding a cron dependency for two
timers.

## Metering never fails a call

`startSession` and the leave-time `settle` are both best-effort at the call
site: the failure is logged and the join or leave proceeds. A database blip
must not take down calling itself, and under-counting on a Livqeno fault is
the right side to err on. A failed `settle` leaves a live row the reaper
closes; a failed `startSession` means one session runs unmetered.

## Enforcement

Two gates, and both are needed:

1. **`RtcTokensService.create`** — `403` with
   `RAVEN_USAGE_LIMIT_EXCEEDED`, carrying `includedMinutes`, `usedMinutes`
   and `remainingMinutes` so an SDK can render the state from the error
   alone. This is the one a developer's backend already handles errors from.
2. **`MessageRouterService.handleJoin`** — a signaling `error` frame with
   `USAGE_LIMIT_EXCEEDED`, before any SFU is allocated. This is the gate
   that actually protects the media plane: a token minted a minute ago,
   while minutes remained, is still a valid credential.

**403, not 402.** `402 Payment Required` tells a client there is something
to pay, and there isn't. It is also not `429`: a rate limit clears by
waiting, and this does not clear at all.

**Sessions in progress are never consulted against the limit.** Cutting off
a live call the moment the last minute ticks over is a worse failure than
overshooting by one session, and a hard stop mid-sentence is not something
a developer can debug. The recorded total can therefore end up slightly
above the granted minutes, and every read path clamps the *display* (never
the stored value) at 100% and zero remaining.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `USAGE_FREE_TIER_MINUTES` | `20000` | Minutes granted to **newly provisioned** allowances. |
| `USAGE_ENFORCE_LIMIT` | `true` | `false` keeps metering but stops refusing sessions. For a self-hosted deployment running its own SFU and TURN fleet, which has no reason to cap itself. |
| `USAGE_METER_INTERVAL_MS` | `30000` | Per-instance sweep interval. The maximum usage a hard crash can lose — not an error that accumulates, since every settlement is a fresh `now - startedAt` reading. |
| `USAGE_REAPER_INTERVAL_MS` | `60000` | How often abandoned sessions are looked for. |
| `USAGE_ABANDONED_AFTER_MS` | `180000` | A live session not settled inside this window is closed. Must comfortably exceed the sweep interval, or the reaper starts closing healthy sessions between their own settlements. |

With enforcement off, `checkProject` still reports `exhausted: true` and
only `blocked` goes false — the dashboard stays honest about the number.

## API

All three take a dashboard session JWT. All three are read-only.

| Route | Returns |
|---|---|
| `GET /v1/usage` | The summary: included, used, remaining, percentage, exhausted state. |
| `GET /v1/usage/detail?limit=&days=` | The summary plus session history, a daily UTC rollup, and a per-project breakdown. |
| `GET /v1/projects/:projectId/usage?limit=&days=` | One project's history against its **owner's** summary. `ownedByCaller` says whether that owner is the caller. |

The first two need no capability check — a developer is always allowed to
read their own meter, and there is no project to be a member of. The third
is gated on `Capability.UsageRead`, which had existed in the role matrix
since it was written and had no route behind it until now. Every role holds
it, including `BILLING`, whose entire grant is `project:read` +
`usage:read` + `billing:manage` — this is the first route that role can
reach. See `docs/roles.md`.

## Dashboard

- `/dashboard/usage` — account-level. The allowance meter, a 30-day chart,
  the per-project breakdown, and the session history.
- `/dashboard/projects/:id/usage` — the same meter, narrowed to one
  project, alongside that project's live infrastructure snapshot (kept
  visually separate: one is what is happening, the other is what has
  happened).

There is no `20000` anywhere in `apps/dashboard`. Every figure, granted
minutes included, arrives in the API's `UsageSummary`. A test asserts it
(`renders whatever allowance the account was granted, never a hardcoded
figure`).

## Tests

| Where | Covers |
|---|---|
| `usage-allowance.service.spec.ts` | Allocation, idempotent provisioning, owner resolution, summary derivation, flooring, clamping, enforcement on/off, history, rollups. |
| `usage-meter.service.spec.ts` | Consumption, delta-only crediting, idempotency, interleaved settlements, the reaper's instant, exhaustion stamping. Uses `testing/fake-usage-store.ts` — real state, so "settling twice counts once" is actually asserted rather than inferred from mock calls. |
| `message-router.service.spec.ts` | Join refused when exhausted, admitted when enforcement is off, meter opened with server-side state only, no meter for a refused join, join survives a metering failure, leave closes the meter. |
| `test/usage-metering.e2e-spec.ts` | Real Postgres: the 20,000-minute grant, twenty parallel sessions summing exactly, eight parallel settlements of one session crediting once, counter-equals-sum, token mint refused at 403, `exhaustedAt` never rewritten, reaper crediting to `lastMeteredAt`, and that no endpoint exists which could grant or reset an allowance. |
| `apps/dashboard/src/__tests__/usage-panels.test.tsx` | Meter semantics and clamping, the exhausted notice (including that it offers no upgrade path), abandoned-session labelling, no hardcoded allowance. |

## What this phase does not include

No admin portal, admin roles, admin authentication, billing, subscriptions,
paid plans, promotional credits, or manual quota adjustment. `UsageModule`
exposes three GET routes and nothing else; an e2e test asserts that POST,
PATCH and DELETE against every usage path 404.

The schema is shaped so that adding those is additive:

| A future phase wanting… | …changes |
|---|---|
| To raise one developer's allocation | `UPDATE usage_allowances SET "includedMinutes" = …`. A data change. No migration. |
| To record *why* it was raised | Add `ADMIN_GRANT` to `UsageAllowanceSource`; one `ALTER TYPE`. |
| Several concurrent grants (promo credits, plan + top-up) | A new `usage_grants` table summing into `includedMinutes`. Additive; the `userId` uniqueness on `usage_allowances` stays meaningful as "the developer's meter". |
| To meter something other than RTC | Add a value to `UsageKind`. The enum forces every aggregation to be revisited, which is the point. |
| Paid usage | Everything above plus a billing subsystem. Nothing in these two tables assumes free, and nothing assumes paid. |

## A note on the RLS migrations

`20260909120000_add_usage_metering` locks the two new tables down the same
way every other table is locked down, but it does so with role-guarded
statements rather than the bare `REVOKE ... FROM anon` the original RLS
migration used. Two companion migrations came out of that:

- `20260908999999_ensure_data_api_roles` — timestamped *before* the
  original RLS migration, because `migrate deploy` applies pending
  migrations in filename order and a later migration cannot rescue a chain
  that has already aborted. It provisions `anon`, `authenticated` and
  `service_role` as inert `NOLOGIN` roles when they are absent, so the
  chain replays on CI, on a scratch database, and on a self-hosted
  Postgres. Provisioning them rather than guarding the statements that use
  them is deliberate: guards would make CI and every self-hoster skip the
  revokes and the policies, so the RLS configuration production actually
  runs would never be exercised anywhere it could be tested.

  The original's fourth role reference, `ALTER DEFAULT PRIVILEGES FOR ROLE
  postgres`, is *guarded* in that migration instead of provisioned here.
  Creating a role named `postgres` on a cluster whose superuser is called
  something else would invent a system-looking account that owns nothing —
  and skipping the statement costs nothing, because bound to `postgres` it
  only ever governed tables created by `postgres`.
- `20260909130000_portable_data_api_lockdown` — the authoritative version.
  It discovers tables from `pg_class` instead of listing them, and binds
  the default-privileges revoke to `current_user` rather than a literal
  `postgres`. That second part closed a real hole: with the revoke bound to
  `postgres`, a deployment whose migration role is anything else went on
  granting all seven privileges to `anon` on every new table.

The rule those encode is in
docs/deployment/managed-postgres.md#never-name-a-role-in-a-migration.
Copy the portable one's shape when adding a table.

## Related

- `apps/docs/content/concepts/usage.md` — the developer-facing page
- `docs/control-plane.md` — the two authentication models these routes sit in
- `docs/observability.md` — `Connection`, and why it is not the billing record
- `docs/rtc/signaling.md` — the join/leave lifecycle metering hangs off
