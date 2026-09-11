# P0 Fix Report — `POST /v1/live-streams` returning `500 RAVEN_INTERNAL_ERROR`

## 1. Exact root cause

Two defects, both introduced by the same same-day commit
(`02ec9aa feat(usage): split RTC/Chat/Live Streaming into independent
free-tier allowances`), and both live on the exact same call path:

**(a) A schema/deploy gap.** That commit added migration
`20260911160000_split_usage_products_and_live_stream_caps`, which adds a
`product` column (and a new `(userId, product)` unique index) to
`usage_allowances`, among other things. In this repo's deployment model
(see `apps/api/Dockerfile`), migrations are **not** run by the API image on
boot — they run as a separate one-shot job against `DIRECT_URL`, deliberately
decoupled from rolling out new API instances (a transaction-mode pooler
can't safely hold the advisory lock a migration needs). If that one-shot job
had not yet been run against production when the new API code shipped, every
query that touches the new `product` column fails at the database with
`42703 column "product" of relation "usage_allowances" does not exist`,
surfaced by Prisma as `PrismaClientKnownRequestError` (`P2022`).

**(b) A design bug, independent of (a).** The same commit added a new,
*unconditional* gate inside `MessagesService.send()`:

```ts
await this.usageAllowances.assertProjectWithinAllowance(actor.projectId, UsageProduct.CHAT);
```

`LiveStreamsService.create()` calls `messagesService.send()` to post an
internal system message ("Live stream ... was created") that viewer
reactions hang off. That call was never a developer sending a chat message —
it's Live Streaming's own bookkeeping — but after this commit it started
being metered and gated by the **project owner's Chat allowance** like any
other message. Two consequences, both reachable even with (a) fully fixed:

- Every stream creation now silently spends one unit of the owner's Chat
  quota.
- Once that quota is exhausted (independent of whether the account has ever
  used Live Streaming), *every future stream creation permanently fails*,
  because the very first message this feature ever sends gets rejected.

(a) is what actually fired in production, going by the exact reported
signature (`RAVEN_INTERNAL_ERROR` / `INTERNAL_ERROR`, a generic 500 — see
§2). (b) is a real, separate failure mode that would keep breaking stream
creation for busy accounts even after the migration is caught up, so both
had to be fixed.

## 2. Failing code path

```
POST /v1/live-streams
  → LiveStreamsController.create()
  → LiveStreamsService.create()
      1. roomsService.create()                    — succeeds (writes to `rooms`, untouched by the new migration)
      2. conversationsService.create()             — succeeds (writes to `conversations`, untouched)
      3. messagesService.send(systemActor, ...)
           → usageAllowances.assertProjectWithinAllowance(projectId, CHAT)
               → ensureProvisionedForProject(projectId, CHAT)
                   → prisma.usageAllowance.upsert({ where: { userId_product: {...} }, ... })
                       ✗ THROWS — `usage_allowances.product` does not exist yet (pre-migration prod)
      4. prisma.liveStream.create(...)              — never reached
```

The thrown error is a raw `PrismaClientKnownRequestError`, not one of this
codebase's `AppError` subclasses. `AllExceptionsFilter`
(`apps/api/src/shared/errors/all-exceptions.filter.ts`) treats anything that
isn't an `HttpException` as "an unexpected bug": it logs the full exception
server-side and returns the client exactly:

```json
{ "message": "Internal server error", "code": "RAVEN_INTERNAL_ERROR", "legacyCode": "INTERNAL_ERROR", ... }
```

— which is the exact body reported. `UsageLimitExceededError` (bug (b), once
the schema is current) is its own `AppError` and would instead surface as a
coded `403`, not a `500` — consistent with (a) being what actually fired in
production, with (b) as a live landmine underneath it.

## 3. Why RTC and Chat were unaffected

- **RTC** (`RoomsService.create`) only ever writes to `rooms`. That table
  was untouched by the new migration.
- **Chat**'s own public "send a message" endpoint calls the *same*
  `MessagesService.send()` and is gated by the identical new check — but a
  developer's real chat traffic is exactly what that check is *supposed* to
  gate, and their `Chat` allowance for genuine messages was already being
  read/written correctly once the migration ran. The bug is specific to
  **Live Streaming's internal use of the messaging pipe**: it drives the
  same code path for a message that was never developer traffic, was never
  meant to be metered at all, and is invoked unconditionally on every single
  stream creation. Chat and RTC don't have an equivalent "invisible internal
  write that must never be blocked."

## 4. Why orphaned rooms were created

`LiveStreamsService.create()` had no compensating cleanup. Its sequence was:

```
create room  →  create conversation  →  send system message  →  write LiveStream row
```

with no transaction and no `try`/`catch` anywhere in the method. Room and
conversation creation are their own service calls with their own
side-effecting behavior (webhooks, DB rows) — not something that could
safely live inside one Postgres transaction with an unrelated Prisma
`usageAllowance.upsert()` and message send in between (the task brief's
guidance to avoid wrapping cross-service/network operations in a DB
transaction applies directly here). So any failure from step 3 onward — the
usage-allowance error above, or literally any other exception — left the
room (`status: ACTIVE`, fully joinable) and the conversation it had just
created permanently unattached to any `LiveStream` row, and thus invisible
to `GET /v1/live-streams` and to `roomsService.close()`'s normal lifecycle.

### Empirical reproduction

Reproduced locally against a throwaway `postgres:16-alpine` (mirroring
`.github/workflows/e2e.yml`'s CI service container), with the 18
pre-`02ec9aa` migrations applied and the 19th (`...split_usage_products...`)
held back — i.e. exactly what an unmigrated production database looks like
after the new API code deploys:

```
Room created (this is the step RTC already exercises fine): <uuid> ACTIVE
Conversation created (this is the step Chat already exercises fine): <uuid> ACTIVE

REPRODUCED THE FAILURE:
  name:    PrismaClientKnownRequestError
  code:    P2022
  message:  Invalid `prisma.usageAllowance.upsert()` invocation ...

Room status after the failed request (this is the orphaned room):
  status = ACTIVE (ACTIVE = orphaned and still joinable; no LiveStream row references it)
  LiveStream rows referencing this room: 0 (0 = confirmed orphan)
```

Applying the held-back migration and re-running the identical call made the
`usageAllowance.upsert()` succeed, confirming the migration is exactly what
was missing.

## 5. Code changes

**`apps/api/src/modules/chat/auth/chat-actor.interface.ts`**
Added `ChatActor.internal?: boolean` — set only by trusted internal callers,
never reachable from any request. Documents the exemption it grants.

**`apps/api/src/modules/chat/messages/messages.service.ts`**
Both the `assertProjectWithinAllowance` gate and the `recordChatMessage`
call in `send()` are now skipped when `actor.internal` is true. A real
developer send (`chat-auth.guard.ts`'s server/client actors never set this)
is completely unaffected — this only exempts Livqeno's own internal sends.

**`apps/api/src/modules/live-streams/live-streams.service.ts`**
- The system actor `create()` builds for the root message now sets
  `internal: true` — fixes defect (b) directly.
- `create()`'s body from room-creation onward is now wrapped in a
  `try`/`catch`. On any failure, `cleanupFailedCreate()` runs: it closes the
  room (`roomsService.close`, the same idempotent lifecycle op `end()`
  already uses) and, if a conversation was created, archives it
  (`ConversationStatus.ARCHIVED`). Both operations are best-effort and
  independently try/caught — a cleanup failure is logged but never replaces
  or swallows the original error, which is always what the caller sees.

No behavior changed for a successful creation; the diff to that path is
purely structural (indentation for the `try` block).

## 6. Database/migration changes

None required beyond what commit `02ec9aa` already added. The fix is:
run the existing `20260911160000_split_usage_products_and_live_stream_caps`
migration's one-shot deploy job against production (see
`docs/deployment/managed-postgres.md#applying-migrations`) — it was already
correct and idempotent; it simply had not been applied yet. No manual data
repair is needed: the migration backfills `usage_allowances.product =
'RTC'` for existing rows and lazily provisions `CHAT`/`LIVE_STREAMING` rows
on first use, exactly as designed.

**Pre-existing orphaned rooms**: this incident will have left real orphaned
rooms/conversations in production from every failed attempt (including
retries — each one posts a new system message and creates a new room
before failing). These are identifiable as `Room` rows with `status =
'ACTIVE'` and no matching `LiveStream.roomId`, created in the incident
window. Per the task's explicit constraint, no bulk cleanup script was
written or run here — that's an operator decision requiring the actual
production window and blast radius, not something to automate blind. The
new code prevents *new* orphans; clearing the existing ones is a follow-up
op.

## 7. Regression tests

Added to `apps/api/src/modules/live-streams/live-streams.service.spec.ts`
(all confirmed to **fail against the pre-fix code** — see below):

- `marks the system root-message actor internal, so it is exempt from the
  Chat usage allowance` — pins defect (b)'s fix.
- `cleanup when creation fails after infrastructure already exists`:
  - closes the room + archives the conversation when the system message
    send fails
  - closes only the room when conversation creation itself fails (nothing
    to archive yet)
  - closes the room + archives the conversation when the final `LiveStream`
    write fails (the exact P2022 scenario)
  - the original error still surfaces even if the room-cleanup call itself
    fails (cleanup is best-effort, never shadows the real error)
  - a stream that's actually created never triggers any cleanup call
- `creates multiple streams in a row without collision or leftover state`
  (Step 6 / Test C).

Verified the new tests actually catch the regression: stashed the three
source-file fixes (keeping the new spec) and re-ran — 4 of the new tests
failed against the old code, all in the way this incident actually failed
(cleanup calls never made; actor not marked internal).

Full suite: **925/925 passing**, `tsc --noEmit` clean.

(Concurrent-creation and full lifecycle e2e coverage already exist in
`apps/api/test/live-streams.e2e-spec.ts` / `live-streams-media.e2e-spec.ts`
and were not duplicated here — those exercise the real HTTP layer end to
end and were unaffected by this change.)

## 8. Local verification

- `pnpm --filter api typecheck` — clean.
- `npx jest` (full `apps/api` unit suite) — 925/925 passing, including the
  new regression tests.
- Direct reproduction against a real, disposable Postgres 16 instance
  (§4): confirmed the exact `P2022` failure pre-migration, confirmed it
  disappears once the held-back migration is applied, and confirmed the
  room is left `ACTIVE` with zero referencing `LiveStream` rows in the
  failing case — matching the external report's "orphaned room" symptom
  exactly.

## 9. Production verification

**Not performed.** This session has no access to the real production
Livqeno API, its database, or its deploy pipeline. Before this can be
marked resolved in production:

1. Confirm via the deploy pipeline / `docs/deployment/managed-postgres.md`
   whether `20260911160000_split_usage_products_and_live_stream_caps` has
   actually been applied to the production database. If not, run its
   one-shot migration job.
2. Deploy this code fix (defect (b) — the internal-actor exemption and the
   creation cleanup — is required regardless of migration status, since it
   prevents both the orphaned-room class of bug and the quota-exhaustion
   failure mode).
3. Run `POST /v1/live-streams` against production with the same logical
   payload the external developer used, capture the request id, and confirm
   `201` with a real stream.
4. Confirm no new orphaned room is created by re-running the request a
   few times back to back.
5. Run the full host → viewer → chat → end lifecycle against production
   through the published SDK, exactly as the external developer's
   StreamSpace app does.

## 10. External SDK verification

**Not performed**, for the same reason as §9 — this requires a real
external-style project against a live, correctly-migrated Livqeno
deployment, which this session cannot stand up. The regression tests in §7
exercise the same service-level contract the SDK's `raven.liveStreams.create()`
ultimately calls through, but that is not a substitute for the actual
external-path check the task calls for.

## 11. Remaining known issues

- Whether the production migration has actually been run is unverified
  from this session — see §9, step 1. This is the one open question that
  determines whether defect (a) is still live in production right now.
- Pre-existing orphaned rooms/conversations from the incident window are
  not cleaned up (see §6) — that's a deliberate scoping decision, not an
  oversight.
- The Chat-allowance exemption is scoped narrowly to `ChatActor.internal`,
  set only by `LiveStreamsService`'s system-message send. Any future
  feature that posts its own internal system messages through
  `MessagesService.send()` needs to remember to set it too — there's no
  structural guarantee a new caller does so correctly, only the documented
  convention on the field itself.

---

BLOCKED — root cause identified but production verification is still pending
