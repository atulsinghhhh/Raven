---
title: Browser security & CORS
description: What your frontend may hold, what it may not, and how per-project allowed origins work.
---

Livqeno is used from the browser, and the browser is the one place where your
code runs on hardware you do not control. This page is the whole story: what
your frontend may hold, what it may not, and why running on
`http://localhost:5173` does not require asking anyone's permission.

The short version:

- Your **Livqeno API key never reaches the browser.** Your backend mints
  short-lived grants; the page gets those.
- **Localhost works out of the box**, on any port, with no configuration.
- **Production origins** are declared per project, under Project Settings →
  Security → Allowed Origins.
- CORS is a browser feature and cannot isolate tenants, so Livqeno does not
  rely on it to. Tenancy is enforced in the server.

## 1. Why CORS exists, and what it is not

A browser will happily let `evil.example` send a request to
`api.ravenstack.online`. What it will not do is let `evil.example` *read the
response*, unless that response says it may. That permission is CORS, and it
protects users from having their ambient credentials — cookies, mostly — spent
by a site they did not intend to authorise.

Two consequences matter here.

**CORS does not authenticate anything.** It answers "may this origin read
this reply", not "who is calling". A request that arrives with a valid token
is authorised by that token whether it came from a browser, `curl`, or a
server. Blocking origins does not protect a token-authenticated API; it only
inconveniences whoever is holding a legitimate token.

**CORS does not apply to WebSockets at all.** There is no preflight on a
WebSocket upgrade and no browser-side check. Livqeno's RTC and chat gateways
therefore validate the `Origin` header themselves — see §6.

## 2. The recommended flow

Your backend holds the API key. The browser holds a grant.

```text
Browser  ──▶  Your backend  ──▶  Livqeno Control Plane
                (API key)          │
                                   ▼
Browser  ◀────────────────────  RTC / chat grant
```

Your backend, once:

```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,      // server-side only, always
  baseUrl: process.env.RAVEN_API_URL!,     // https://api.ravenstack.online
});

app.post('/api/rtc/token', async (req, res) => {
  // Identity comes from *your* session. Never from the request body, or any
  // caller can claim to be anyone.
  const grant = await raven.tokens.create({ room: roomId, identity: req.user.id });
  res.json(grant);
});
```

Your frontend, forwarding the grant untouched:

```ts
import { createRTCClient } from '@ravenkash/rtc';

const grant = await fetch('/api/rtc/token', { method: 'POST' }).then((r) => r.json());

const client = createRTCClient(grant);   // token, endpoint, iceServers
const room = await client.join();        // the token names its own room
```

Nothing in that frontend is a secret, and nothing in it is a Livqeno URL you
chose. `endpoint`, `iceServers` and `telemetryUrl` all arrive inside the
grant, so the same code runs against a local control plane and the hosted one
with no change.

## 3. Localhost development

**It already works.** `http://localhost:3000`, `:5173`, `:8080`,
`127.0.0.1`, `[::1]` — any loopback host, any port, http or https, with
nothing to register.

This is deliberate rather than accidental. A page on a loopback address is on
the developer's own machine, and it still needs a valid grant to do anything;
there is no version of this where registering port numbers with Livqeno would
have made anyone safer.

It is also **not** a wildcard. `https://localhost.evil.example` is a real DNS
name someone else controls, and it is rejected. Only genuine loopback hosts
qualify.

A project that has shipped can turn it off — `allowLocalhostOrigins: false`,
or the toggle in the dashboard — at which point only the configured
production origins are accepted.

## 4. Production origins

Declare them per project:

```text
Project Settings → Security → Allowed Origins
```

```text
https://app.example.com
https://example.com
```

An entry is a bare origin: scheme, host, and a port if it is not the
default. Anything else is refused when you save it, with the offending
entries named, rather than stored and silently never matched:

| Entry | |
| --- | --- |
| `https://app.example.com` | ✅ |
| `http://localhost:3000` | ✅ (also covered by §3) |
| `https://app.example.com/dashboard` | ❌ a path is not part of an origin |
| `https://*.example.com` | ❌ wildcards are not supported |
| `app.example.com` | ❌ no scheme |

Wildcards are rejected on purpose. `https://*.example.com` reads as a
convenience and behaves as a standing grant to every present and future
subdomain, including one an attacker manages to take over. List the
subdomains you actually use.

**An empty list means unconfigured, and unconfigured is open.** Every project
that predates this feature has an empty list, and defaulting those to "deny"
would have broken live applications for a setting nobody had the chance to
fill in. Enforcement begins for a project the moment it adds its first
origin — so adding one is a meaningful act, and the dashboard says so.

Values are matched exactly after normalisation, so `https://APP.example.com/`
and `https://app.example.com` are the same entry, and `https://example.com`
does **not** cover `https://app.example.com`.

### When a change takes effect

Immediately, for connections made after you save.

Livqeno caches each project's origin policy — the check runs on every
telemetry event, chat REST call and WebSocket upgrade, so it cannot be a
database query each time — but saving a change invalidates that cache
across the whole API fleet, not just whichever server handled your save.
So removing an origin stops it being accepted straight away rather than
lingering for a cache lifetime, which matters because that is the
direction where staleness would be a security problem rather than a
nuisance.

Connections **already open** are unaffected. Origin is checked when a
connection is established, so removing an origin does not disconnect the
pages already connected from it; they stop being able to reconnect. If you
need to cut existing sessions, close the room
(`DELETE /v1/rooms/{roomId}`).

## 5. Why the API key must stay server-side

A Livqeno API key is long-lived and project-wide. It can mint tokens for any
room and any identity, read your project's diagnostics, and manage your
rooms. A grant, by contrast, is scoped to one identity, one room or
conversation, and expires in an hour or less.

So: never put `RAVEN_API_KEY` in HTML, browser JavaScript, a bundler's
`NEXT_PUBLIC_*`/`VITE_*` variable, a source map, `localStorage`, or a cookie
readable by JavaScript. A key in a browser bundle is a key you have
published — treat it as leaked and rotate it.

`@ravenkash/server` is a backend package for this reason and says so in its
own README. If you find yourself importing it in a component, the token flow
in §2 is the thing you actually want.

## 6. HTTP CORS vs WebSocket Origin validation

These are genuinely different mechanisms and Livqeno treats them differently.

**HTTP.** SDK surfaces — `/v1/telemetry/*` and `/v1/chat/*` — return
permissive CORS headers, so the browser never blocks a legitimate SDK call
and you never see an opaque "blocked by CORS policy" with nothing to act on.
Tenancy is then enforced *after* authentication: if the page's origin is not
allowed for the project the token belongs to, the request gets a `403` that
names the origin and the setting to change.

That split exists because a preflight is unauthenticated by design. An
`OPTIONS` request carries no `Authorization` header, so at the moment the
browser asks "may I?", Livqeno does not yet know which project is asking. It
cannot give a per-tenant answer, so it does not pretend to — the real answer
comes on the request that actually carries a credential, and it comes as an
error you can read.

**WebSockets.** No preflight, no browser check, so the gateway validates
`Origin` itself, immediately after verifying the token. The token carries the
project, so this check is per-tenant from the start. A rejected upgrade
closes with `ORIGIN_NOT_ALLOWED`, which the SDKs surface as a permission
error and never retry — reconnecting cannot fix a dashboard setting.

Both gateways do this: `/v1/chat/ws` and `/v1/rtc` alike. Worth saying
explicitly, because CORS does not apply to a WebSocket upgrade at all —
there is no browser-side check to fall back on, so a gateway that skipped
this would let any page open a connection with a valid token.

A request with **no** `Origin` header is allowed through both paths: browsers
always send one, so its absence means a server-side caller, which is not what
this control is for. It is not a bypass either — the caller still needs a
valid token, and any token holder can drop the header. This is why origin
policy is defence in depth and the token is the actual control.

## 7. RTC grant architecture

```text
Your backend ──(API key)──▶ Control plane ──(grant)──▶ Your frontend ──▶ SFU
```

```ts
const grant = await raven.tokens.create({ room: roomId, identity: session.userId });
// { token, endpoint, iceServers, telemetryUrl, roomName, expiresAt, ... }
```

The frontend forwards it whole. It never needs `RAVEN_API_KEY`, an SFU
address, STUN/TURN URLs, or TURN credentials — those last two are minted with
a short lifetime and arrive in `iceServers`.

## 8. Chat grant architecture

```text
Your backend ──(API key)──▶ Control plane ──(grant)──▶ Your frontend ──▶ Chat gateway
```

```ts
const grant = await raven.chat.createToken({
  userId: session.userId,
  conversations: [conversationId],
});
// { token, chatUrl, apiUrl, scopes, conversations, expiresAt, ... }
```

```ts
const chat = createChatClient(grant);   // token + chatUrl + apiUrl
await chat.connect();
```

`chatUrl` and `apiUrl` are in the grant precisely so the browser never
composes a WebSocket address. A chat token's claims are the user, the
project, its scopes and its conversations — there is no address in it to
derive one from, which is why the grant carries both.

The gateway enforces, on every connection: the token's signature and expiry,
that the token has not been revoked, the project it belongs to, the user
identity it names (a client token can only ever act as itself — the request
body cannot override `senderId`), the conversations it is scoped to, and the
project's origin policy.

## 9. Live Streaming authentication

Host and viewer credentials come from **different methods**, and that is the
security boundary — the role is decided by which method your backend calls,
never by a field in a request body:

```ts
const stream = await raven.live.create({ title: 'Launch day', hostIdentity: session.userId });

// Publish access. Call it only after your own authorization check.
const host = await raven.live.addHost(stream.id, { identity: session.userId, role: 'HOST' });

// Always subscribe-only on RTC, always MEMBER on chat. No way to widen it.
const viewer = await raven.live.createViewerToken(stream.id, viewerId);
```

Both return `{ identity, role, rtc, chat? }`, where `rtc` is an ordinary RTC
grant and `chat` an ordinary chat grant — so everything above applies
unchanged. A viewer token cannot be talked into publishing, and neither can
reach a stream in another project: the project is fixed in the signature.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `403 Origin … is not allowed for this project` | The page's origin is not on the list. Add it under Project Settings → Security → Allowed Origins. |
| `ORIGIN_NOT_ALLOWED` on connect | Same, on a WebSocket. Retrying will not help. |
| `TOKEN_REVOKED` on connect | This token was revoked (`DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}`). Mint a new one; retrying cannot help. See [RTC authentication](/rtc/authentication#revocation). |
| `blocked by CORS policy` on your *own* API | The failing request is to your backend, not to Livqeno. Configure CORS there. |
| Telemetry POST failing but calls working | Telemetry is best-effort and never blocks RTC. Pass `telemetry: false` to silence it. |

## Related

- [Security](/authentication/security) — the wider threat model
- [API keys](/authentication/api-keys) — creating and rotating them
- [Access tokens](/authentication/tokens) — grant contents and lifetimes
