# Livqeno Chat security audit

This is the Phase 12 security review (spec §39), written as a record of what
was checked, what holds, and what doesn't. Each finding names the code that
enforces it, so a reviewer can verify rather than take this on trust.

## Three credentials, three keys

```
Dashboard session JWT   →  signed with JWT_SECRET          →  developer, whole account
Project API key         →  bcrypt + pepper, never stored raw →  backend, whole project
Chat token              →  signed with CHAT_TOKEN_SECRET   →  one user, short-lived
RTC token               →  signed with RTC_TOKEN_SECRET    →  one participant, one room
```

**None can mint or impersonate another.** Chat tokens carry a fixed
`aud: "raven-chat"`, so even a shared key wouldn't let a session JWT be
replayed on the chat plane — verified in
`chat-token.service.spec.ts` ("rejects a correctly-signed token minted for a
different audience") and end-to-end in `chat.e2e-spec.ts` ("rejects an RTC
token — the two planes do not share credentials").

Production refuses to start if `CHAT_TOKEN_SECRET` is unset or equal to
`JWT_SECRET` (`env.validation.ts`). Local development falls back to
`JWT_SECRET` so a `git pull` still runs; production does not.

## The identity chokepoint

Every write derives its actor from the signed credential, never from the
request body. One function decides it:

```ts
// chat-actor.interface.ts
export function resolveSubjectId(actor: ChatActor, requested?: string | null) {
  if (actor.kind === 'client') return actor.userId;   // body ignored entirely
  return requested ?? actor.userId;
}
```

A browser token passing `senderId: 'someone-else'` is not an error — the value
is discarded. Covered by unit tests (`chat-permissions.spec.ts`) and E2E
(`chat.e2e-spec.ts`, "ignores a client-supplied senderId").

Server actors *can* name a user, because that's how a backend posts on
someone's behalf. That's precisely why an API key must never reach a browser.

## Authorization

Two independent checks, both server-side, both in
`ConversationsService.authorize()` — the single chokepoint every chat
operation passes through:

1. **Token scope.** A token pinned to specific conversations can't wander into
   others, even ones the user legitimately belongs to.
2. **Membership.** A `ChatMember` row must exist and be `ACTIVE`. The role
   determines the scopes; the token can only narrow them.

| Check | Enforced |
|---|---|
| Cross-project access | `resolve()` scopes every lookup by `projectId` |
| Non-member reads | `authorize()` → `NOT_A_MEMBER` |
| Non-member WebSocket subscribe | `handleRoomJoin()` calls `authorize()` before subscribing |
| Editing another user's message | Author check in `MessagesService.update()` |
| Deleting another user's message | Requires `chat:moderate` |
| Forged system messages | `assertMessageTypeAllowed()` — server actors only |
| Privilege escalation via scopes | `narrowScopes()` intersects; never widens |
| Conversation creation from a browser | `assertServerActor()` on the controller |
| Attachment access | Membership + `chat:read` before any signed URL is issued |

**Cross-project lookups return "not found", not "forbidden."** A 403 would
confirm the id exists somewhere else, which is a tenant-enumeration oracle.

## Transport

- `wss://` required in production. `ws://` is local-development only.
- **Origin checked** on upgrade against `CORS_ORIGIN`, rejecting a mismatch
  with close code `4403`. A *missing* Origin is allowed: browsers always send
  it and page JavaScript cannot forge it, so the check defends against the
  attack it exists for, while non-browser clients (bots, load tests) still
  work.
- The token travels in the **query string**, because the browser WebSocket API
  cannot set headers on an upgrade. This is a real exposure — URLs reach proxy
  logs — and it's mitigated by short lifetimes (1h default, 6h max, no
  non-expiring option), revocability, and per-user scoping. It is not
  eliminated. Documented in `docs/chat/websocket.md#authentication` rather
  than glossed over.

## Token lifecycle

- Signed HS256, compared in **constant time** (`timingSafeEqual`) — a plain
  `!==` leaks signature bytes through timing.
- Every token has a `jti`, revocable independently.
- Revocation tombstones in Redis expire with the token, so revocation state
  never accumulates.
- **Redis being down does not lock everyone out.** The revocation check fails
  open, logged loudly — a partial outage shouldn't become a total one.
  Explicitly a trade-off: revocation is delayed by the outage.
- A socket whose token expires mid-session is **closed by the heartbeat**
  (code `4440`), not left open indefinitely.

## Input validation

- Frames are **size-checked before `JSON.parse`** — parsing a 50 MB frame to
  then reject it is the denial of service.
- Every frame's shape is validated before dispatch; unknown types are rejected
  by name.
- Text length counts code points; metadata is measured in bytes after
  serialisation.
- HTTP DTOs use `whitelist` + `forbidNonWhitelisted`, so unknown fields are
  rejected rather than silently ignored.
- All database access is through Prisma's parameterised queries — no string
  interpolation anywhere in the chat module.

**Message content is not HTML-escaped or sanitised.** Livqeno stores what it's
given and returns it verbatim, because sanitising would corrupt legitimate
content (code snippets, Markdown) and the correct escaping depends on where
it's rendered. **Rendering safely is the client's job** — React escapes by
default; if you use `dangerouslySetInnerHTML`, sanitise first.

## Rate limiting

Redis-backed, so limits hold across gateway instances — an in-memory counter
would let a client multiply its budget by reconnecting to a different
instance.

| Scope | Default | Keyed by |
|---|---|---|
| Connections | 30 / 60s | client IP |
| Sends | 30 / 10s | user |
| Reactions | 60 / 10s | user |
| Typing | 20 / 10s | user |
| Subscriptions | 60 / 60s | user |

Connection limiting runs **before** token verification, so an attacker can't
extract free signature verifications.

Limiters **fail open** when Redis is unreachable, logged loudly. Refusing all
traffic during a Redis blip would turn a degradation into an outage; the
trade-off is stated rather than hidden.

## Attachments

- Storage credentials never leave the server; the browser gets a signed URL
  addressing exactly one object.
- Keys are `chat/{project}/{conversation}/{random}` — **never the
  user-supplied filename**, so `../../../other-tenant/secrets` traverses
  nowhere.
- Filenames are stripped of path separators and control characters, so a
  newline in a filename can't become header injection in a
  `Content-Disposition`.
- Size validated before a URL is issued; content type pinned into the
  signature.
- Only the uploader can attach it, once, to one message.
- Download URLs are short-lived and issued only after a membership check.
- `STORAGE_ENDPOINT` must be `https://` in production.

## Webhooks

- HMAC-SHA256 over `"{timestamp}.{raw body}"`. The timestamp is **inside** the
  signed payload, so a captured delivery can't be replayed with a fresh one
  bolted on.
- Signing secret shown once, never returned again.
- Reference verifier uses a constant-time compare, and checks length first —
  `timingSafeEqual` throws on mismatched lengths, which would crash a receiver
  instead of rejecting a bad signature.
- Failing endpoints auto-disable after 50 consecutive failures.
- Errors are truncated and response bodies are never stored — a hostile
  endpoint can return anything.

**SSRF is partially mitigated.** Loopback, RFC 1918, link-local and
non-HTTP schemes are refused outside local development. This is
**hostname-level only**: it does not resolve DNS, so a hostname pointing at a
private IP still passes, as does a redirect to one. **A production deployment
should egress-filter the webhook worker.** Known limitation, not a
mitigation.

## Privacy

- **Message contents are never logged.** Logs carry ids, types and timings.
- The dashboard shows metadata only — counts, timestamps, connection state.
  The API doesn't return message text to that surface, so the restriction is
  structural rather than a UI decision someone could quietly undo.
- Deleted messages have their body withheld from API responses entirely
  (`text`, `metadata`, `attachment`, `reactions`), so a client can't recover
  content from the payload.
- Tokens, secrets, and credentials never appear in logs or error messages.
- Malformed input is never echoed back — it's attacker-controlled.

## Error handling

Unhandled exceptions are logged in full server-side and returned as
`INTERNAL_ERROR`. A client shouldn't be able to learn your schema from an
error message.

## Residual risks

Stated plainly, because a security document that only lists strengths isn't
one:

1. **Tokens in WebSocket URLs.** Unavoidable with the browser WebSocket API.
   Mitigated by short TTLs and revocation, not eliminated.
2. **Webhook SSRF via DNS.** Hostname checks don't resolve names. Egress
   filtering is the real fix and is deployment-side.
3. **Rate limiters fail open.** A Redis outage removes rate limiting. The
   alternative — failing closed — turns a degradation into an outage.
4. **No message content encryption at rest.** Messages are stored in plain
   Postgres columns. Disk encryption is the deployment's responsibility;
   end-to-end encryption is incompatible with server-side history and search.
5. **Client-asserted upload completion.** Confirming an upload that didn't
   happen leaves a message pointing at an empty key. Visible immediately,
   scoped to that user.
6. **No per-message audit log.** Edits record `editedAt` and deletions record
   `deletedBy`, but there's no full revision history.
7. **Load-tested to 300 connections on one machine.** Behaviour at
   substantially higher scale is unmeasured — see
   `docs/chat/architecture.md#measured-limits`.

## Verification

| Area | Tests |
|---|---|
| Token signing, expiry, tampering, revocation | `chat-token.service.spec.ts` (19) |
| Scopes and identity resolution | `chat-permissions.spec.ts` (14) |
| Payload limits and type restrictions | `message-limits.util.spec.ts` (18) |
| Cursor opacity and validation | `cursor.util.spec.ts` (11) |
| Webhook signatures and replay | `webhook-signature.util.spec.ts` (16) |
| SigV4 correctness | `s3-presign.util.spec.ts` (8) |
| Auth, authorization, limits, isolation | `chat.e2e-spec.ts` (30, real Postgres + Redis) |
