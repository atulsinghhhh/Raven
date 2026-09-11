---
title: Usage
description: The three independent free-tier allowances every developer account gets — RTC minutes, Chat messages, Live Streaming host-hours — how each is counted, where to read them, and what happens when one runs out.
---

Every Livqeno developer account is granted three **independent** free-tier
allowances:

| Product | Included | Unit |
|---|---|---|
| RTC | **10,000** | participant-minutes/account |
| Chat | **100,000** | messages/account |
| Live Streaming | **100** | host-hours/account |

Each is metered separately, and using one never draws down another. A
project that spends its whole Chat allowance can still make RTC calls, mint
new live streams, and vice versa. All three are visible in the dashboard
under [Usage](https://app.ravenstack.online/dashboard/usage), each as its
own card.

Existing accounts registered before this change keep their original
**20,000-minute** RTC grant — the number above is what a *newly registered*
account gets. See [Reading your usage](#reading-your-usage) for why.

## RTC: participant-minutes

One **participant-minute**: one participant, connected to one room, for one
minute.

A two-person call for ten minutes consumes **twenty** minutes. A three-way
call for the same ten consumes thirty. This is the unit because it is the
unit the media plane actually costs — an SFU forwards a stream per
participant, not per room.

Metering is per participant-session, so a participant who drops and
rejoins produces two sessions, each counted for the time it was actually
connected.

**Live Streaming viewers and hosts do not count here.** See below — Live
Streaming has its own allowance now, entirely separate from RTC.

## Chat: messages

One **message**, counted once — at the moment the server durably persists
it, never once per recipient it's delivered to. A message to a
100-member conversation still costs exactly one message.

```text
User A sends "hello"  → 1 chat message
User B sends "hi"     → 1 chat message
Total                 → 2 chat messages
```

**What does not count as a message:** typing indicators, presence,
read/delivery receipts, and reactions. None of these are stored as chat
messages — typing and presence never touch Postgres at all, receipts are a
position, not a log, and a reaction is its own row on its own table. Only
an actual message send counts.

**Retries never double-count.** Every message carries a `clientMessageId`
(the SDK attaches one automatically), and the server enforces uniqueness on
`(conversation, sender, clientMessageId)` — a retried send returns the
original message and consumes nothing new, whether the retry happens a
second later or an hour later on a different connection. See
[Chat messages](/chat/messages) for the full idempotency contract.

## Live Streaming: host-hours, plus product limits

Live Streaming has its own allowance — **100 host-hours** — measured from
actual host/co-host **connected duration**, not the stream's total wall-clock
length:

```text
Stream starts: 10:00
Host leaves:   10:37
→ 37 minutes of host-hours consumed

Host reconnects:
10:00 → 10:20 = 20 min
10:25 → 10:40 = 15 min
→ 35 minutes consumed — the 5-minute gap is excluded
```

Two co-hosts streaming for an hour each consume **2 host-hours**, not 1 —
every active host/co-host's connected time counts independently.

**Viewers never consume anything.** Not host-hours, not RTC minutes,
nothing. A stream with 100 viewers watching for an hour spends exactly what
its host(s) spent connected — the viewer count has no effect on the meter
at all.

```text
100 viewers watching for 1 hour
does NOT consume 100 × 60 minutes of anything.
The host's connected time is the only thing metered.
```

### Product limits (not the allowance)

Separate from the 100-host-hour allowance, three free-tier ceilings apply
to every stream:

| Limit | Default | Meaning |
|---|---|---|
| Concurrent streams | **1** | At most one `LIVE` stream at a time, per account — across every project and environment you own. Starting a second one is refused with `403 RAVEN_STREAM_CONCURRENCY_LIMIT_EXCEEDED` until the first ends. |
| Viewers per stream | **100** | The 101st viewer-token request for a stream is refused with `403 RAVEN_STREAM_VIEWER_LIMIT_EXCEEDED`. |
| Stream duration | **4 hours** | A stream still `LIVE` past 240 minutes is automatically ended. |

These are concurrency/capacity ceilings, not consumption — hitting one
means "not right now, not another one," never "you're out of allowance."

## Where the RTC and Live Streaming counts come from

The signaling layer, from its own clock — unchanged mechanism, now serving
two products:

- A meter opens when the control plane **accepts a join** — after the RTC
  token is verified, after an SFU is allocated, and after that SFU confirms
  the participant. For a live-stream room, whether it opens against RTC or
  against Live Streaming's host-hours (or not at all, for a viewer) is
  decided at that same moment, from server-side state — never from
  anything the client claims to be.
- It is settled periodically while the call runs, and again when the
  participant leaves.
- If the API instance holding a session dies, the session is closed by a
  sweep and credited only up to the last moment it was **confirmed
  alive** — never to the moment the sweep noticed. You are not charged for
  a Livqeno outage.

**The client cannot influence its own usage**, for any of the three
products. Nothing in the SDK reports usage, and no request body carries a
duration or a message count.

**Metered figures will not exactly match connection durations.**
[Connection](/concepts/connection) records are event-sourced from
best-effort client telemetry — useful for debugging, deliberately not the
billing record. Where the two disagree, the metered figure is authoritative.

## Whose allowance gets spent

The **project owner's** — for all three products.

A project's usage draws down the allowance of the account that owns the
project, whichever member is in the room/conversation/stream and whoever
minted the credential. A developer added to someone else's project spends
that owner's allowances, not their own — the project's usage page says so
explicitly when you are reading a project you do not own.

## Reading your usage

Through the dashboard, or the API with a dashboard session:

```bash
curl https://api.ravenstack.online/v1/usage \
  -H "Authorization: Bearer $SESSION_JWT"
```

```json
{
  "includedMinutes": 10000,
  "usedMinutes": 4812,
  "remainingMinutes": 5188,
  "usedPercent": 48.1,
  "exhausted": false,
  "exhaustedAt": null,
  "enforced": true,
  "source": "FREE_TIER",
  "grantedAt": "2026-02-14T09:12:04.881Z",
  "usedSeconds": 288721,
  "liveSessions": 2,
  "chat": {
    "used": 43200,
    "limit": 100000,
    "unit": "messages"
  },
  "liveStreaming": {
    "hostHoursUsed": 37,
    "hostHoursLimit": 100,
    "concurrentStreams": 1,
    "maxConcurrentStreams": 1,
    "maxViewers": 100,
    "maxStreamDurationMinutes": 240
  }
}
```

The RTC figures are flat at the top level — unchanged from before Chat and
Live Streaming got their own allowances, so existing code reading
`includedMinutes` etc. keeps working untouched. `chat` and `liveStreaming`
are new sibling fields.

`GET /v1/usage/detail` adds RTC session history, a daily rollup and a
per-project breakdown, plus the same `chat`/`liveStreaming` blocks. Chat and
Live Streaming get summary figures only in this phase — no history
breakdown for them yet. `GET /v1/projects/{projectId}/usage` narrows the
RTC figures to one project; `chat`/`liveStreaming` stay account-wide (they
aren't split per project). See the [Observability API reference](/api/observability).

Read every figure from the response rather than hardcoding the numbers at
the top of this page. Each allowance is stored per account, so an account
keeps what it was granted even if the defaults change later — see
[When an allowance runs out](#when-an-allowance-runs-out).

## When an allowance runs out

Each of the three allowances is enforced independently — running out of one
never affects the other two.

- **RTC exhausted:** new RTC tokens are refused (`POST
  /v1/rooms/{roomId}/rtc-tokens` returns `403 RAVEN_USAGE_LIMIT_EXCEEDED`)
  and new room joins are refused (signaling `error` frame,
  `USAGE_LIMIT_EXCEEDED`).
- **Chat exhausted:** new messages are refused at send time, same code and
  status.
- **Live Streaming host-hours exhausted:** registering a new host or
  co-host is refused, same code and status. Viewers are unaffected — they
  never spent this allowance to begin with.
- **Sessions/messages already in progress are never cut off.** A live call
  is never terminated mid-sentence, and an in-flight send that was already
  accepted isn't retroactively rejected — which is why a recorded total can
  end up slightly above the included amount.
- **Everything else keeps working**: projects, API keys, the parts of Chat
  and Live Streaming that aren't the specific thing that ran out,
  webhooks, observability, the dashboard.

**None of the three allowances reset** — not monthly, not annually, not on
sign-in. There is no paid plan to upgrade to and no payment path: Livqeno
has no billing.

Handle it as a terminal error rather than something to retry:

```ts
try {
  const token = await raven.rtcTokens.create(roomId, { participantIdentity: 'alice' });
} catch (err) {
  if (err.code === 'RAVEN_USAGE_LIMIT_EXCEEDED') {
    // Retrying will not help — nothing frees up over time.
    return showOutOfAllowance(err.product, err.remaining);
  }
  throw err;
}
```

The error body carries `product`, `unit`, `included`, `used` and
`remaining` for all three products — RTC's error additionally carries the
older `includedMinutes`/`usedMinutes`/`remainingMinutes` keys, kept for
backward compatibility with code written against the single-pool model.

Live Streaming's *product limits* (concurrency, viewers, duration) are
separate errors — `RAVEN_STREAM_CONCURRENCY_LIMIT_EXCEEDED` and
`RAVEN_STREAM_VIEWER_LIMIT_EXCEEDED` — deliberately distinct from
`RAVEN_USAGE_LIMIT_EXCEEDED`: these mean "not right now," not "you're out,"
so a client can tell the two apart.

## Self-hosting

Environment variables read by `apps/api`:

| Variable | Default | Effect |
|---|---|---|
| `USAGE_FREE_TIER_RTC_MINUTES` | `10000` | Minutes granted to **newly provisioned** RTC allowances. Renamed from `USAGE_FREE_TIER_MINUTES`. Existing accounts keep what they were granted. |
| `USAGE_FREE_TIER_CHAT_MESSAGES` | `100000` | Messages granted to newly provisioned Chat allowances. |
| `USAGE_FREE_TIER_LIVE_HOST_HOURS` | `100` | Host-hours granted to newly provisioned Live Streaming allowances. |
| `USAGE_FREE_TIER_LIVE_CONCURRENT_STREAMS` | `1` | Max concurrent `LIVE` streams per account. |
| `USAGE_FREE_TIER_LIVE_MAX_VIEWERS` | `100` | Max viewers per stream. |
| `USAGE_FREE_TIER_LIVE_MAX_STREAM_DURATION_MINUTES` | `240` | Max wall-clock duration of one stream. |
| `USAGE_ENFORCE_LIMIT` | `true` | Set `false` to keep metering but stop refusing usage, for every product. A deployment running its own SFU and TURN fleet has no reason to cap itself. |

With enforcement off, the dashboard still reports each allowance as
exhausted once it is — the figures stay honest, only the refusal goes away.
Live Streaming's product limits (concurrency, viewers, duration) are
enforced independently of `USAGE_ENFORCE_LIMIT` — they're capacity
ceilings, not part of the allowance model that flag governs.

See [Environment variables](/self-hosting/environment-variables).
