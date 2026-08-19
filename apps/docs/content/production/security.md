---
title: Security
description: Four credentials, none of which can mint or impersonate another.
---

## Four credentials, four keys

```
Dashboard session JWT   signed with JWT_SECRET             developer, whole account
Project API key         bcrypt + pepper, never stored raw  backend, whole project + one environment
Chat token              signed with CHAT_TOKEN_SECRET      one user, short-lived
RTC token               signed with the SFU's own secret   one participant, one room
```

**None can mint or impersonate another.** Chat tokens carry a fixed
`aud: "raven-chat"`, so even a shared signing key wouldn't let a
dashboard session be replayed on the chat plane.

Production refuses to start if `CHAT_TOKEN_SECRET` is unset or equal to
`JWT_SECRET`. Local development falls back so a fresh clone still runs;
production does not.

## The identity chokepoint

Every write derives its actor from the signed credential, never from the
request body:

```ts
export function resolveSubjectId(actor: ChatActor, requested?: string | null) {
  if (actor.kind === 'client') return actor.userId; // body ignored entirely
  return requested ?? actor.userId;
}
```

A browser token passing `senderId: 'someone-else'` isn't an error — the
value is silently discarded. Server actors *can* name a user, because
that's how a backend posts on someone's behalf, and it's exactly why an
API key must never reach a browser. See
[Authentication](/authentication).

## Authorization is two independent checks

**What the token allows** — scopes, narrowed from a role, never widened.
**What you're actually a member of** — checked server-side on every
request, never trusted from a client-cached list. Both have to pass. See
[Chat → Authorization](/chat#authorization--two-independent-checks)
and [Roles & Permissions](/production/roles-and-permissions) for the
control-plane equivalent.

## Secrets

- An API key's secret half is bcrypt-hashed with a server-side pepper —
  never stored raw, never recoverable, shown to you exactly once.
- A webhook signing secret **is** stored (delivery signing requires it)
  but never returned again after creation.
- Server SDKs keep the API key in a private field — never enumerable,
  never in `JSON.stringify()`/`repr()`, never logged, never in a thrown
  error. See [Node.js SDK](/sdk/node) and
  [Python SDK](/sdk/python).

## Attachments

Storage credentials never reach the browser — only a signed URL scoped
to one object, for a few minutes. Storage keys are random, never the
user-supplied filename, closing the obvious path-traversal attempt
outright rather than sanitizing it. See
[Attachments](/chat/attachments#security-properties).

## What's a known limitation, stated rather than implied

Webhook SSRF protection is hostname-level only — it refuses obvious
internal targets but doesn't resolve DNS, so a hostname that resolves to
a private IP still gets through. A production deployment should
egress-filter the delivery worker at the network level. See
[Webhooks → Security](/webhooks#security).

## Reporting a vulnerability

Reach the team on [Discord](https://discord.com/invite/HSWd9qMC7), or
your account contact if you have one — Raven's source and issue tracker
aren't public, so a security report isn't something to post in the
open.
