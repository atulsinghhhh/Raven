# raven-sdk — Python server SDK

Backend-only. Mints short-lived RTC tokens and reads real project data
(rooms, connections, errors, metrics, diagnostics) using a permanent
project API key. **Never import this into any frontend/browser-adjacent
code** — see `docs/security/server-sdk.md`. Works the same with FastAPI,
Django, Flask, or plain Python — no framework-specific SDK.

## Installation

```bash
pip install raven-sdk
```

Requires Python ≥3.10. Uses modern typing (`dataclasses`, `TypedDict`,
`X | None`) throughout — no untyped dicts in the public API.

## Initialization

```python
import os
from raven import Raven

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])
```

`api_key` is the only required argument. The SDK **never reads
`RAVEN_API_KEY` (or any other environment variable) on its own** — you
always pass it explicitly.

```python
raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url="https://your-raven-deployment.example",  # defaults to http://localhost:4100
    timeout=10.0,     # seconds, defaults to 10 — a request never hangs indefinitely
    max_retries=2,    # defaults to 2
)
```

Use it as a context manager to close the underlying connection pool:

```python
with Raven(api_key=os.environ["RAVEN_API_KEY"]) as raven:
    ...
```

## Async support

```python
from raven import AsyncRaven, CreateTokenParams

async def main():
    async with AsyncRaven(api_key=os.environ["RAVEN_API_KEY"]) as raven:
        token = await raven.tokens.create(CreateTokenParams(room=room_id, identity="user-42"))
```

`AsyncRaven` mirrors `Raven`'s full resource surface — same method
names, `await`ed. Both are built on `httpx` (`Client`/`AsyncClient`),
the one dependency this package has.

## Resources

Every method below maps to a real, existing Control API endpoint.

### `raven.projects`

```python
project = raven.projects.get()  # the one project this API key belongs to
```

No `list()`/`create()`/`update()`/`delete()` — an API key is already
scoped to exactly one project; those remain human/dashboard-session
operations.

### `raven.tokens` — the core of this SDK

```python
from raven import CreateTokenParams, TokenPermissions

token = raven.tokens.create(
    CreateTokenParams(
        room=room_id,  # a room's ID, not its display name
        identity="user-42",
        permissions=TokenPermissions(join=True, subscribe=True, publish=True, publish_audio=True, publish_video=True),
        expires_in=3600,  # seconds — every token is short-lived by design
    )
)
# {"token": ..., "endpoint": ..., "iceServers": [...], "telemetryUrl": ..., "expiresAt": ..., ...}
```

Return this straight to your frontend — see `examples/python-server`
(FastAPI) and `docs/security/server-sdk.md#authorization-model`. Never
mint a token in the browser; never log or persist a minted token any
longer than it takes to forward it.

### `raven.rooms`

```python
raven.rooms.list()
raven.rooms.get(room_id)
raven.rooms.create("lobby")
raven.rooms.delete(room_id)  # soft-closes (status: CLOSED), never a hard delete
```

### `raven.rooms.participants`

```python
participants = raven.rooms.participants.list(room_id)
# None = the SFU couldn't be reached; [] = genuinely empty — never coerced together
one = raven.rooms.participants.get(room_id, "user-42")  # None if not present
```

Always the SFU's **live** state — no stored join/leave history, and no
"remove/kick" (that capability doesn't exist in the Control API yet).

### `raven.connections` / `raven.errors` (Phase 9 observability)

```python
from raven import ListConnectionsParams, ListErrorsParams

raven.connections.list(ListConnectionsParams(room_id=room_id, state="CONNECTED", limit=50))
raven.connections.get(connection_id)

raven.errors.list(ListErrorsParams(category="ICE_ERROR", connection_id=connection_id, limit=50))
raven.errors.get(error_id)
```

Typed dataclass filters only — never an arbitrary query string. See
`docs/error-codes.md` and `docs/observability.md`.

### `raven.metrics` / `raven.diagnostics`

```python
raven.metrics.get("1h")      # '15m' | '1h' | '24h' | '7d' — real aggregates; also today's "usage" view
raven.diagnostics.get()      # signaling/SFU/TURN health + this project's real active-connection count
```

### `raven.chat` — Raven Chat, server-side

The important method is `create_token()`. The whole security model rests
on it: your backend authenticates the user *its* way, then asks Raven for
a short-lived token scoped to that one user. Only that token reaches the
browser or the mobile app — the API key never does.

```python
from raven import CreateChatTokenParams, CreateConversationParams, ConversationMember, SendChatMessageParams

conversation = raven.chat.create_conversation(
    CreateConversationParams(
        name="support-room-42",
        members=[
            ConversationMember(user_id="alice", role="ADMIN"),
            ConversationMember(user_id="bob"),
        ],
    )
)

token = raven.chat.create_token(
    CreateChatTokenParams(
        user_id=request.user.id,          # from YOUR session, never the request body
        conversations=[conversation["publicId"]],
        expires_in=3600,
    )
)
# Hand token["token"] to the browser. Nothing else.
```

`scopes` can only ever *narrow* what the user's role already allows —
listing `chat:moderate` does not grant it. That makes it safe to pass a
caller's scope list straight through without re-checking.

Membership and moderation:

```python
raven.chat.add_member(room, "carol", role="MODERATOR")
raven.chat.remove_member(room, "carol")
raven.chat.list_members(room)
raven.chat.list_conversations()
raven.chat.get_conversation(room)
```

`room` accepts a `conv_…` id, the conversation's name, or the id of an
attached RTC room — whichever you happen to be holding.

Posting and reading:

```python
raven.chat.send_message(room, SendChatMessageParams(
    sender_id="system",
    text="Maintenance in 5 minutes",
    type="system",           # server-only — a browser token is refused this
))

page = raven.chat.list_messages(room, ListChatMessagesParams(limit=50))
older = raven.chat.list_messages(room, ListChatMessagesParams(before=page["nextCursor"]))

raven.chat.delete_message("msg_abc")   # soft delete, keeps an audit trail
```

`system` messages are available here and nowhere else, because a browser
must never be able to fabricate an official-looking announcement.

Pass `client_message_id` to make a retried backend job idempotent — the
same key returns the original message instead of posting a duplicate.

Everything is mirrored on `AsyncRaven.chat` with the same names.

## Error model

```python
from raven import RavenError

try:
    raven.rooms.get("missing-room")
except RavenError as error:
    print(error.code)         # e.g. "NOT_FOUND"
    print(error.status_code)  # e.g. 404
    print(error.request_id)   # correlates with the Control API's own x-request-id
```

`RavenError` is built entirely from the parsed response body and
headers — never from anything that could carry your API key. Never a
stack trace from the server, a database error, or TURN/RTC credentials.

## Retries

Transient failures only — network errors, timeouts, and HTTP
429/502/503/504 — bounded exponential backoff (`max_retries`, default
2). **Never retried**: 400/401/403/404 or any other 4xx.

## Timeouts

`timeout` (seconds, default 10) bounds every request — never hangs
indefinitely even against an unreachable host.

## Pagination

Chat message history is cursor-paginated: `list_messages()` returns
`nextCursor` (walk back through history) and `previousCursor` (walk
forward to catch up). Pass them back verbatim — they're opaque, and
there is deliberately no `offset` parameter to reach for.

Everything else returns a flat list, optionally capped with `limit`
where the endpoint supports it. Those endpoints have no cursor.

## Idempotency

Chat message sends support it: pass `client_message_id` to
`send_message()` and a retry with the same key returns the original
message rather than creating a second one. That's what makes a retried
job or a redelivered queue item safe.

No other endpoint has idempotency-key handling.

## Security

- The API key lives only in a name-mangled attribute
  (`self.__api_key` → `self._RavenHttpClient__api_key`), never a plain
  public attribute — not trivially visible via `vars()`/`repr()`.
- Never logged, never included in a raised `RavenError`.
- See `docs/security/server-sdk.md`.

## Known limitations

Same as the TypeScript SDK — no webhook management (webhooks are
configured from the dashboard or the JWT-guarded endpoints), no RTC
participant removal, and no usage/billing beyond `raven.metrics.get()`.
See `docs/sdk/server/typescript.md#known-limitations`.

Chat-specific: no attachment upload helpers yet (mint the ticket through
the API directly), and no server-side WebSocket client — this SDK is for
provisioning and reading, while real-time delivery belongs to the browser
and mobile SDKs.
