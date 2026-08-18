---
title: Authentication
description: Three separate credential types, and why the client never sees your API key.
---

Raven has three authentication layers. Confusing them is the most common
integration mistake, so it's worth being precise about each.

```
Your application's auth      your users log into your app — Raven has no part in this
        ≠
Raven API auth                your backend ↔ Raven, via a permanent API key
        ≠
Client auth (RTC/chat)         a browser or device ↔ Raven, via a short-lived token
```

## The flow

```
User logged into your app
        │
        ▼
Your backend checks your own app's permissions for this user
        │
        ▼
Your backend calls Raven with its API key:
  raven.tokens.create({ room, identity, permissions })
  raven.chat.createToken({ userId, conversations, scopes })
        │
        ▼
Raven mints a short-lived, narrowly scoped token
        │
        ▼
Client uses that token with @raven/rtc or @raven/chat — never the API key
```

The critical property: **a client can never request its own token.**
Identity and permissions are decided by your backend from its own
authenticated session, never from a value the client sends. A client
that could name its own identity could impersonate any other user.

## API keys

An API key (`rvk_<env>_...`) is a permanent, project-and-environment-scoped
credential — treat it like a database password.

- Lives only in your backend's secret storage. Never in a frontend
  bundle, never in a mobile app binary, never committed to source
  control.
- Both server SDKs require it passed explicitly
  (`apiKey: process.env.RAVEN_API_KEY`) — neither scans the environment
  automatically. Implicit env-scanning is exactly the kind of behavior
  that picks up a key from the wrong place.
- Scoped to one [environment](/production/environments). A development
  key cannot mint a production token, however it's asked.
- Revocable independently: `raven keys revoke <id>`. Rotating a key
  never touches the tokens it already issued — those expire on their own.

## Tokens

A token is short-lived and scoped narrowly:

| | RTC token | Chat token |
|---|---|---|
| Grants | join / publish / subscribe on one room | read / send (and more) on named conversations |
| Lifetime | minutes to hours, capped at 6h | configurable, always short-lived |
| Identity | set once, by your backend | signed into the token, never overridable |
| Where it's used | `createRTCClient({ token, endpoint })` | `createChatClient({ token })` |

Both carry the environment they were minted in as part of the signed
claim — a token minted with a development key can only ever reach
development data, regardless of what a client sends.

## What the SDKs guarantee

- An API key lives only in a private field — never a plain object
  property, never enumerable, never in `JSON.stringify()`/`repr()`.
- Never logged, at any log level, by any SDK.
- Never included in a thrown error. Errors carry only `{message, code,
  requestId}` — see [Error Codes](/reference/errors).

## Next

- [Tokens](/server/tokens) — the full server-side minting API.
- [Environments](/production/environments) — how the environment a
  token was minted in follows it everywhere.
- [Roles & Permissions](/production/roles-and-permissions) — who on
  your team can create keys, and for which environment.
