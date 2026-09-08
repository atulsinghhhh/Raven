---
title: FAQ
description: Questions that come up repeatedly, answered from the implementation.
---

## Getting started

### Do I need a backend?

Yes. A client cannot mint its own token, and the API key that mints one
must never reach a browser. The backend can be tiny — one route that calls
`raven.tokens.create()` — but it has to exist.

### Can I try it without a backend at all?

For a first look, mint a token with `curl` and paste it into a page. It
expires in ten minutes, which is exactly why that is fine for a demo and
not fine for a product.

### Which SDK do I install?

One for your backend (`@corvidhq/server` or `raven-sdk`) and one for your
client, by platform. [Install an SDK](/get-started/install-an-sdk) has the
table.

### Are the packages on npm yet?

No. All packages are at `0.1.0` and unpublished. Install from a checkout —
[Installing from source](/getting-started/installing-from-source).

## Tokens and authentication

### How long should a token last?

As short as your join flow tolerates. The default is 600 seconds and that
is a good answer for most apps. There is no revocation for an issued RTC
token, so the lifetime *is* the control.

### What happens when a token expires mid-call?

Nothing. The token is checked at join. An expired token only matters when
something tries to connect again — which is the reconnect path. Chat is
different: wire `onTokenExpiring` or the connection ends at expiry.

### Can I reuse one token for several participants?

No. Identity is signed into the token, and two clients presenting the same
identity in one room conflict. Mint one per participant.

### Why can't I revoke a token?

RTC tokens have no revocation list — by design. If you need to eject
someone, close the room or stop minting them tokens. Chat tokens are
checked against a revocation set at connect, but no public endpoint
currently triggers a revocation; see
[Known limitations](/reference/known-limitations).

## Rooms and calls

### Do I have to create a room before minting a token?

Yes — the mint route is scoped to a room id.

### What happens to a room when everyone leaves?

The media server is released. The room record stays, so its name is still
taken and its history still resolves. Deleting a room is a soft close to
`CLOSED`.

### How many participants fit in a room?

50 by default (`SIGNALING_MAX_PARTICIPANTS_PER_ROOM`). Past that, joins are
refused with `ROOM_FULL`. Whether 50 *works well* depends on your network
and how many video tracks you render — see
[Build a group call](/guides/build-a-group-call).

### Why does `join()` accept a room name and the mint call want an id?

The token carries both, so joining accepts either. Minting is a REST route
keyed on the id. Passing `room.id` to both is always correct.

### Can two participants have the same identity?

They should not. Identity is unique within a room, and duplicates break the
roster.

## Chat

### Is chat separate from RTC?

Completely. Different socket, different token, different package. Use
either alone, or both — a call with a chat panel is two independent
connections, by design.

### Why do I receive my own messages back?

Because everyone renders the row the *server* stored. `sendMessage()`
resolving is the durability signal; the `message` event is the fan-out.
Render from the event and every client agrees on order.

### Is "delivered" available per recipient?

No, deliberately. A socket receiving bytes is not evidence a person saw
them — a backgrounded tab receives everything. Build on `read`, which
requires a client action.

### Are messages kept forever?

By default, yes. Set `CHAT_RETENTION_DAYS` or a per-conversation override.

## Live streaming

### How many viewers can a stream take?

Unproven at scale. Raven's own tests reach 100 participants on loopback
with synthetic media. A large broadcast is a different problem and has not
been measured.

### Can I record a stream?

No. Recording does not exist anywhere in Raven.

### Can a viewer become a host mid-stream?

Your backend calls `addHost()` and hands the viewer the new credentials;
the client rejoins with them. A client cannot promote itself — publish
permission is signed into the token.

## Operations

### Do I have to self-host?

No, but Raven is open source and self-hosting is a first-class path. See
[Self-hosting](/self-hosting).

### Why isn't Postgres in the Docker Compose stack?

Because a database in a throwaway volume is the wrong default for something
holding every message you have. Point at any Postgres.

### Which browsers work?

Chromium is the only one exercised with real media. Support is
feature-detected, so others report as supported — a claim about
capabilities, not interop. See [Browser support](/sdk/browser-support).

### Do I need TURN?

In practice yes. Without a relay, a share of users on corporate and mobile
networks get calls that connect and carry nothing. See
[TURN & NAT traversal](/self-hosting/turn).

### What does Raven send about my users?

Connection lifecycle and media statistics. No media, no message content,
no credentials. Switch it off with `telemetry: false`. See
[Telemetry & privacy](/backend/telemetry).

## Next steps

- [Known limitations](/reference/known-limitations) · [Troubleshooting](/troubleshooting)
- [Concepts](/concepts) — if a term here was unfamiliar.
