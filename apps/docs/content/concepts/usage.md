---
title: Usage
description: The Raven minutes included with every developer account — how they are counted, where to read them, and what happens when they run out.
---

Every Raven developer account is granted **20,000 free RTC minutes**. Usage
is metered by the control plane as calls run, and the total is visible in
the dashboard under [Usage](https://app.ravenstack.online/dashboard/usage).

## What counts as a minute

One **participant-minute**: one participant, connected to one room, for one
minute.

A two-person call for ten minutes consumes **twenty** minutes. A three-way
call for the same ten consumes thirty. This is the unit because it is the
unit the media plane actually costs — an SFU forwards a stream per
participant, not per room.

Metering is per participant-session, so a participant who drops and
rejoins produces two sessions, each counted for the time it was actually
connected.

## What is not counted

| | |
|---|---|
| Chat | Messages, reactions, attachments, presence — none of it consumes minutes. |
| Live Streaming | The product itself is not metered. Its hosts and viewers *are* ordinary RTC participants, so their media time is counted as RTC minutes. |
| Effects | Runs entirely in the client. Nothing to meter. |
| TURN relay bandwidth | Not counted or attributed. |
| API requests, webhooks, storage | Not counted. |

## Where the count comes from

The signaling layer, from its own clock. Specifically:

- A meter opens when the control plane **accepts a join** — after the
  RTC token is verified, after an SFU is allocated, and after that SFU
  confirms the participant. A join that failed any of those is not counted.
- It is settled periodically while the call runs, and again when the
  participant leaves.
- If the API instance holding a session dies, the session is closed by a
  sweep and credited only up to the last moment it was **confirmed
  alive** — never to the moment the sweep noticed. You are not charged for
  a Raven outage.

Two consequences worth knowing:

**The client cannot influence its own usage.** Nothing in the SDK reports
usage, and no request body carries a duration. A client that never
announces its disconnect is closed by the sweep above; one that lies about
anything is not asked in the first place.

**Metered minutes will not exactly match connection durations.**
[Connection](/concepts/connection) records are event-sourced from
best-effort client telemetry — useful for debugging, deliberately not the
billing record. Where the two disagree, metered minutes are authoritative.

## Whose minutes get spent

The **project owner's**.

A project's sessions draw down the allowance of the account that owns the
project, whichever member is in the room and whoever minted the token. A
developer added to someone else's project spends that owner's minutes, not
their own — the project's usage page says so explicitly when you are
reading a project you do not own.

## Reading your usage

Through the dashboard, or the API with a dashboard session:

```bash
curl https://api.ravenstack.online/v1/usage \
  -H "Authorization: Bearer $SESSION_JWT"
```

```json
{
  "includedMinutes": 20000,
  "usedMinutes": 4812,
  "remainingMinutes": 15188,
  "usedPercent": 24.1,
  "exhausted": false,
  "exhaustedAt": null,
  "enforced": true,
  "source": "FREE_TIER",
  "grantedAt": "2026-02-14T09:12:04.881Z",
  "usedSeconds": 288721,
  "liveSessions": 2
}
```

`GET /v1/usage/detail` adds the session history, a daily rollup and a
per-project breakdown. `GET /v1/projects/{projectId}/usage` narrows it to
one project. See the [Observability API reference](/api/observability).

Read `includedMinutes` from the response rather than hardcoding 20,000.
It is stored per account, so an account keeps the allowance it was granted
even if the default changes.

## When the minutes run out

At 20,000 minutes:

- **New RTC tokens are refused** — `POST /v1/rooms/{roomId}/rtc-tokens`
  returns `403` with `code: "RAVEN_USAGE_LIMIT_EXCEEDED"`.
- **New room joins are refused** — the signaling WebSocket answers with an
  `error` frame carrying `code: "USAGE_LIMIT_EXCEEDED"`.
- **Sessions already in progress are not cut off.** A live call is never
  terminated mid-sentence, which is why the recorded total can end up
  slightly above 20,000.
- **Everything else keeps working**: projects, API keys, chat, webhooks,
  observability, the dashboard.

The allowance **does not reset** — not monthly, not annually, not on
sign-in. There is no paid plan to upgrade to and no payment path: Raven has
no billing.

Handle it as a terminal error rather than something to retry:

```ts
try {
  const token = await raven.rtcTokens.create(roomId, { participantIdentity: 'alice' });
} catch (err) {
  if (err.code === 'RAVEN_USAGE_LIMIT_EXCEEDED') {
    // Retrying will not help — nothing frees up over time.
    return showOutOfMinutes(err.remainingMinutes);
  }
  throw err;
}
```

The error body carries `includedMinutes`, `usedMinutes` and
`remainingMinutes`, so a client can render the state without a second
request.

## Self-hosting

Two environment variables, both read by `apps/api`:

| Variable | Default | Effect |
|---|---|---|
| `USAGE_FREE_TIER_MINUTES` | `20000` | Minutes granted to **newly provisioned** accounts. Existing accounts keep what they were granted. |
| `USAGE_ENFORCE_LIMIT` | `true` | Set `false` to keep metering but stop refusing sessions. A deployment running its own SFU and TURN fleet has no reason to cap itself. |

With enforcement off, the dashboard still reports the allowance as
exhausted once it is — the figure stays honest, only the refusal goes away.

See [Environment variables](/self-hosting/environment-variables).
