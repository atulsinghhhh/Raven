# P0 Fix Report — `POST /v1/live-streams` returning `500 RAVEN_INTERNAL_ERROR`

## 1. Exact root cause

Two independent, confirmed defects, both on the exact same call path inside
`LiveStreamsService.create()`, plus a third, unrelated infrastructure gap
discovered while getting the fix live. All three are real; the write-up
below is honest about which one actually produced the reported incident
versus which ones were found and fixed regardless.

**(a) No compensating cleanup — confirmed the direct cause of the incident.**
`create()`'s sequence is: create room → create conversation → post an
internal system message → write the `LiveStream` row. Nothing wraps any of
this in a transaction or a `try`/`catch`. A failure at *any* step after the
room exists leaves that room (and, if reached, the conversation) permanently
orphaned: `ACTIVE`, joinable, and attached to no `LiveStream` row a developer
can ever see or close. Confirmed directly against production data: **15 real
orphaned rooms and 15 matching orphaned conversations**, all `stream_...`
named, all created in a 34-minute window (08:42–09:16 UTC on 2026-09-11),
against **0 successful stream creations** in that same window. This is the
concrete, data-backed confirmation of the incident, independent of exactly
which downstream call threw.

**(b) A design bug found in current `main`, not proven to be what actually
fired in production.** `main` at commit `02ec9aa` added a new, unconditional
gate inside `MessagesService.send()`:

```ts
await this.usageAllowances.assertProjectWithinAllowance(actor.projectId, UsageProduct.CHAT);
```

`LiveStreamsService.create()` calls `send()` to post an internal system
message ("Live stream ... was created") that viewer reactions hang off —
never developer traffic, but after `02ec9aa` it started being gated by the
**project owner's Chat allowance** like any other message. This is a real,
reproducible bug (see §4) and was fixed (§5). **However**: the commit that
was actually deployed to production at the time of the incident,
`7fda609` (2026-09-10, predates `02ec9aa` entirely), does not contain this
check at all — its `messages.service.ts` has no usage-allowance logic
whatsoever. So (b) cannot be what caused the specific 15 orphans found in
§(a); it is a genuine defect in the code that had been merged to `main` but
had not yet actually reached production. It is fixed regardless, because it
would have caused the same class of failure the moment the correct commit
did ship.

**(c) An unrelated deploy-pipeline gap, discovered while trying to get any
fix live at all.** `infrastructure/azure/13-api-app.sh` never wired
`METRICS_SCRAPE_SECRET` into the Container App spec, but
`env.validation.ts` has required it in production since commit `6d6c63c`.
Every deploy since that commit merged crash-looped at boot (confirmed:
restart counts of 13 and 53 on the two most recent revisions), and Azure
Container Apps was silently keeping traffic on the last revision that
actually stayed up rather than surfacing the failure — so `/health` kept
reporting green throughout, masking that **no new deploy had actually taken
effect in some time**. This is why root-causing this incident required
pulling live container logs and replica state directly, rather than trusting
`az containerapp show`'s reported "active revision." Fixed in §5.

## 2. Failing code path (as reproduced; not proven identical to the live incident's exact stack trace)

```
POST /v1/live-streams
  → LiveStreamsService.create()
      1. roomsService.create()          — succeeds
      2. conversationsService.create()  — succeeds
      3. messagesService.send(systemActor, ...)   ← any failure here, or in step 4, orphans the room
      4. prisma.liveStream.create(...)
```

Locally, with the `02ec9aa` usage-allowance check present and its migration
held back, step 3 throws a raw `PrismaClientKnownRequestError` (`P2022`),
which is not one of this codebase's `AppError` subclasses.
`AllExceptionsFilter` treats anything that isn't an `HttpException` as an
unexpected bug and returns a generic `500 RAVEN_INTERNAL_ERROR` — the exact
signature reported. This proves the *class* of failure (an unhandled
exception at this exact point in `create()` reliably produces the reported
symptom and orphans the room) even though, per §1(b), it is not proven to be
the literal exception that fired against `7fda609` in production — no
historical logs survive that window (no Log Analytics workspace is wired to
this Container App environment) to pin the exact stack trace after the
fact.

## 3. Why RTC and Chat were unaffected

- **RTC** (`RoomsService.create`) only ever writes to `rooms` and never
  calls into the chat/messaging or usage-allowance code at all.
- **Chat**'s own public "send a message" endpoint calls the same
  `MessagesService.send()`, but for a developer's real chat traffic, being
  gated by their own Chat allowance is correct behavior, not a bug. The
  defect is specific to **Live Streaming's internal use of the messaging
  pipe** to post a message that was never developer-authored and is invoked
  unconditionally on every single stream creation — RTC and Chat have no
  equivalent "invisible internal write that must never be blocked."
- More fundamentally: RTC and Chat's own creation paths (`Room`,
  `Conversation`) are single-step writes. Live Streaming is the only one of
  the three that composes multiple other services' side-effecting calls
  into one logical operation with no compensating cleanup — that structural
  gap (§1a) is what actually orphaned resources, regardless of which single
  call in the chain happened to throw.

## 4. Why orphaned rooms were created

See §1(a). Confirmed twice:

**Locally**, against a throwaway `postgres:16-alpine` (mirroring
`.github/workflows/e2e.yml`'s CI container) with all pre-`02ec9aa`
migrations applied and the usage-split migration held back:

```
Room created (the step RTC already exercises fine): <uuid> ACTIVE
Conversation created (the step Chat already exercises fine): <uuid> ACTIVE

REPRODUCED THE FAILURE:
  name: PrismaClientKnownRequestError, code: P2022
  (usageAllowance.upsert() — product column doesn't exist yet)

Room status after the failed request: ACTIVE, 0 LiveStream rows reference it
```

**In production data** (read-only queries against the real database): 15
orphaned rooms, 15 matching orphaned conversations (1:1 by `stream_...`
name), all in the 08:42–09:16 UTC window, versus exactly 2 `LiveStream` rows
ever created successfully (both already `ENDED`, from before the incident).

## 5. Code changes

**`apps/api/src/modules/chat/auth/chat-actor.interface.ts`**
Added `ChatActor.internal?: boolean` — set only by trusted internal callers,
never reachable from any request.

**`apps/api/src/modules/chat/messages/messages.service.ts`**
Both the `assertProjectWithinAllowance` gate and the `recordChatMessage`
call in `send()` are skipped when `actor.internal` is true. A real
developer send is completely unaffected.

**`apps/api/src/modules/live-streams/live-streams.service.ts`**
- The system actor `create()` builds for the root message now sets
  `internal: true`.
- `create()`'s body from room-creation onward is wrapped in a
  `try`/`catch`. On any failure, `cleanupFailedCreate()` closes the room
  (`roomsService.close`, the same idempotent op `end()` already uses) and,
  if a conversation was created, archives it (`ConversationStatus.ARCHIVED`).
  Both are best-effort and independently try/caught — a cleanup failure is
  logged but never shadows the original error.

No behavior changed for a successful creation.

**`infrastructure/azure/13-api-app.sh`** (§1c)
Wired a newly-generated `metrics-scrape-secret` (added to Key Vault,
nothing existing rotated) into the Container App spec as
`METRICS_SCRAPE_SECRET`.

## 6. Database/migration changes

None authored. The `20260911160000_split_usage_products_and_live_stream_caps`
migration (added by `02ec9aa`) was already correct; production's schema was
confirmed **fully up to date** (`prisma migrate status` → "up to date";
directly verified `usage_allowances.product`/`includedCount`/`consumedCount`,
its unique index, `live_streams.ownerId`, and
`live_streams_one_live_per_owner` all exist) by the time this session
investigated. `_prisma_migrations` shows it was actually applied at
**2026-09-11T12:36:10 UTC** — after the 08:42–09:16 incident window, so the
DB was in whatever state matched the code actually running (`7fda609`) at
the time of the incident; no schema/code version mismatch was present
during the incident itself.

**Pre-existing orphaned rooms**: the 15 identified in §4 were left in place,
per the task's explicit instruction not to bulk-delete orphans without
understanding why they exist. They're now fully understood; clearing them
is a follow-up op, not done in this session.

## 7. Regression tests

Added to `apps/api/src/modules/live-streams/live-streams.service.spec.ts`
(confirmed to **fail against the pre-fix code** — verified by stashing the
three source-file fixes and re-running; 4 of the new tests failed):

- `marks the system root-message actor internal, so it is exempt from the
  Chat usage allowance`
- `cleanup when creation fails after infrastructure already exists`: closes
  room+conversation on a message-send failure, closes only the room when
  conversation creation itself fails, closes room+conversation when the
  final `LiveStream` write fails, the original error still surfaces even if
  cleanup itself fails, and a genuinely successful creation never triggers
  cleanup.
- `creates multiple streams in a row without collision or leftover state`.

Full suite: **925/925 passing**, `tsc --noEmit` clean.

## 8. Local verification

- `tsc --noEmit` clean; full `apps/api` unit suite 925/925 passing.
- Direct reproduction against a real, disposable Postgres 16 instance:
  confirmed the `P2022` failure with the migration held back, confirmed it
  disappears once applied, and confirmed the room is left orphaned in the
  failing case.

## 9. Production verification — **completed**

This session had real (authorized, explicitly confirmed) access to the
actual production Azure subscription, Supabase database, and Key Vault.
What was found and done:

1. **Migration status**: confirmed already applied (§6) — no action needed.
2. **Deploy investigation**: `az containerapp show` reported the "active"
   revision as `f6cd76288f9...` (current `main` `HEAD`), but this was
   misleading — that revision, and the one built from this fix
   (`raven-api--0000005` and `--0000006`), were both crash-looping
   (`ActivationFailed`, restart counts 53 and 13) on the `METRICS_SCRAPE_SECRET`
   gap (§1c). Real traffic was quietly still being served by
   `raven-api--0000004` (image `7fda609`, from 2026-09-10) via Azure's
   fallback-to-last-healthy-revision behavior — confirmed by matching a
   live request's `x-request-id` against that revision's own container
   logs.
3. **Fixed the deploy gap** (§5), rebuilt nothing (same image tag,
   `20703bf`, already contained the Live Streaming fix), and the user
   re-ran `13-api-app.sh`. New revision `raven-api--0000007` came up
   `Running`/`Healthy`, replica `ready: true`, `restartCount: 0` —
   confirmed for real this time by matching a fresh request's
   `x-request-id` against `--0000007`'s own live logs.
4. **Live API verification**, against the real production endpoint, using a
   real API key on the project that had the original orphans:
   - `POST /v1/live-streams` × 3, fresh titles/identities: all `201`,
     distinct rooms/conversations, zero collisions.
   - Zero new orphaned rooms/conversations after any of it.
   - `start` (CREATED→LIVE), `addHost` (HOST role, full RTC+chat
     credentials), `viewer-tokens` (VIEWER role, RTC `publish:false`
     confirmed on every permission field, chat MEMBER role) — all `201`.
   - Host and viewer both sent real chat messages via
     `POST /v1/chat/conversations/:id/messages`; both persisted with
     correct `senderId`; the list endpoint showed all of them, including the
     `internal` system message sitting right alongside real user messages —
     the concrete, live proof that the Chat-allowance exemption works.
   - `end` (LIVE→ENDED); a subsequent viewer-token mint correctly rejected
     with `409 RAVEN_STREAM_INVALID_STATE`, not a 500.
5. **Real WebRTC media**, using the actual published `@ravenkash/rtc`
   client SDK (not raw SDP/WebSocket) against the real production
   SFU/TURN/signaling stack, from two isolated, throwaway Chromium
   instances (Playwright, synthetic fake camera/mic devices — no real
   hardware or personal browser session involved):
   - Host published microphone + camera; viewer subscribed to both.
   - Verified with two `getStats()` samples 3 seconds apart on the
     viewer's receive-side tracks: **audio** — Opus, 0% packet loss,
     1ms jitter, ~23.7 kbps steady; **video** — VP8, 320×180 @ 20fps, 0%
     packet loss. Real, decoded, live media — not an HTTP 200 or a
     connection-established event standing in for it.
   - All 5 test streams created during verification were cleanly ended
     afterward; a final read-only sweep confirmed zero orphaned
     rooms/conversations from any of this session's testing.

All of the task's original STOP conditions were checked and none tripped:
no `P2022`, no `42703`, no new orphaned room, no generic
`RAVEN_INTERNAL_ERROR`, health checks pass, host published and viewer
received real media, chat worked, end worked.

## 10. External SDK verification

Partially done. §9's media test used the actual published-shape
`@ravenkash/rtc` client SDK bundle (the same one `examples/video-call`
ships), talking only to public HTTP/WS endpoints and real tokens minted
through the public API — not internal source, not raw SDP. What's still
outstanding, per the task's own Phase 13: a from-scratch external project
using only public docs and `npm install @ravenkash/*`, and the dashboard's
own frontend (Vercel) pointed at this API. Not attempted — that's a
materially separate exercise from verifying the API/SFU stack itself.

## 11. Remaining known issues

- ~~The 15 pre-existing orphaned rooms/conversations from the original
  incident are still in the database, identified but not cleaned up (§6).~~
  **Cleaned up 2026-09-12** via `apps/api/scripts/cleanup-orphaned-live-stream-rooms.ts`,
  which reuses `RoomsService.close()` (same idempotent op the fix's own
  `cleanupFailedCreate` uses) plus the same direct `ConversationStatus.ARCHIVED`
  update. Ran dry-run first (found exactly the same 15, matching the report's
  count and shape), then `--execute`: all 15 rooms closed, all 15 matching
  conversations archived, a final read-back confirmed 0 orphans remain
  matching the same query.
- The exact exception that fired against `7fda609` during the original
  08:42–09:16 incident is not recoverable (no surviving logs) — §1(a)'s
  structural fix (compensating cleanup) closes the bug regardless of which
  specific downstream call was the trigger, so this doesn't block the fix,
  but it means the *precise* historical stack trace is unconfirmed.
- The Vercel frontend (Phase 12) has not been deployed/pointed at this API
  in this session — that remains the user's manual step.
- The from-scratch external-developer-path check (Phase 13, clean project,
  published npm packages only) has not been run.
- The Chat-allowance exemption is scoped narrowly to `ChatActor.internal`;
  any future internal system-message sender needs to remember to set it —
  no structural guarantee enforces this, only the documented convention.

---

FIXED — Live Streaming creation and lifecycle verified end-to-end in production, including real host→viewer WebRTC media and chat. Vercel frontend deployment and the from-scratch external-SDK path (Phases 12–13) remain outstanding and are the user's next manual step.
