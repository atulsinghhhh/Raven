---
title: Security
description: Four credentials, none of which can mint or impersonate another, and the rules that keep it that way.
---

## Four credentials

| Credential | Held by | Lifetime | Can mint others? |
|---|---|---|---|
| Dashboard session (JWT) | A developer, the CLI | 12h | No |
| Project API key | Your backend | Permanent until revoked | **Yes** — tokens |
| RTC token | A browser or device | ≤ 6h | No |
| Chat token | A browser or device | ≤ 6h | No |

Each is signed with its **own secret** — `JWT_SECRET`, `RTC_TOKEN_SECRET`,
`CHAT_TOKEN_SECRET` — and carries a fixed audience claim. So a leaked
dashboard-session secret cannot mint a chat token, and a chat token can
never be replayed as an RTC token. The separate secrets are the first lock;
the audience claim is the second.

## The one rule

**A server secret must never reach a browser client.**

That means:

- No API key in a frontend bundle, a mobile binary, a source map, or a
  committed file.
- No API key in a `NEXT_PUBLIC_*`-style variable, or any variable your
  bundler inlines.
- No minting a token in client code, however convenient it looks.

A client gets a token. A token is short-lived, scoped to one room or a named
set of conversations, and useless anywhere else. If it leaks, the damage is
bounded by its expiry and its scope; if an API key leaks, it is bounded by
nothing until you revoke it.

## Why a client cannot mint its own token

Because identity would then be self-asserted. A client that names its own
`identity` can name someone else's, and every authorization decision
downstream is built on that string.

Your backend takes identity from its **own** authenticated session and
passes it to Raven. Raven signs it. Nothing after that can change it.

## What the SDKs guarantee

- The API key lives only in a private class field — never an enumerable
  property, never in `JSON.stringify()` or a Python `repr()`.
- It is never logged, at any level, by any SDK.
- It is never included in a thrown error. Errors carry `{message, code,
  requestId}` and nothing else.
- No SDK ever returns a TURN credential you did not already receive in a
  mint response.

## Transport

Use `https://` and `wss://` in production.

A chat token travels in the WebSocket URL's query string, because the
browser WebSocket API cannot set an `Authorization` header on an upgrade —
no browser client can. That is a real trade-off: URLs reach proxy logs and
browser history. It is why chat tokens are short-lived, revocable, and
scoped, and it is why plain `ws://` is a local-development affordance only.

## Origin checks

The chat gateway checks the upgrade's `Origin` against `CORS_ORIGIN` and
rejects a mismatch with close code `4403`. Page JavaScript cannot forge
`Origin`. A *missing* `Origin` is allowed, because non-browser clients
legitimately do not send one.

Do not ship `CORS_ORIGIN=*` to production.

## Webhook receivers

Verify the signature. An unverified endpoint accepts anything anyone POSTs
to it. Use a constant-time compare, sign the raw body, and reject a stale
timestamp — [Webhooks](/webhooks#verifying-a-delivery) has a reference
implementation and explains each of the three.

## Known gaps

Stated rather than implied:

- **Webhook SSRF protection is hostname-level only.** Raven refuses
  non-HTTP schemes, loopback and private-range literals, and production
  additionally requires `https://`. It does **not** resolve DNS, so a
  hostname that resolves to a private address still passes, as does a
  redirect to one. Egress-filter the delivery worker at the network level.
- **An issued RTC token cannot be revoked early.** The short lifetime is
  the control.

More in [Known limitations](/reference/known-limitations).

## Related

- [API keys](/authentication/api-keys) · [Permissions](/authentication/permissions)
- [Security](/production/security) · [Production checklist](/production/checklist)
