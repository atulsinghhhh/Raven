---
title: Python SDK
description: Server-side RTC and chat — sync and async, built on httpx.
---

`raven-sdk` is Raven's server-side Python SDK. It runs on your backend,
holds your API key, and mints the tokens your frontend actually uses —
see [Authentication](/getting-started/authentication).

## Install

> **Not published to PyPI yet — and do not `pip install raven-sdk`.**
> That name is already taken on PyPI by an unrelated project ("Async
> Kafka and HTTP producer SDK for Raven AI logs"), so installing it
> gets you someone else's package, not this one. Install from a local
> checkout instead — see
> [Installing from source](/getting-started/installing-from-source).
> The final published name will be announced before release.

## Initialization

```python
from raven import Raven

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])
```

The API key is required explicitly — the SDK never scans the environment
for it. Use it as a context manager to close the underlying connection
pool:

```python
with Raven(api_key=os.environ["RAVEN_API_KEY"]) as raven:
    ...
```

### Async

```python
from raven import AsyncRaven, CreateTokenParams

async def main():
    async with AsyncRaven(api_key=os.environ["RAVEN_API_KEY"]) as raven:
        token = await raven.tokens.create(CreateTokenParams(room=room_id, identity="user-42"))
```

`AsyncRaven` mirrors `Raven`'s full surface — same method names, awaited.
Both are built on `httpx`, the one dependency this package has.

## RTC tokens

```python
from raven import CreateTokenParams, TokenPermissions

token = raven.tokens.create(
    CreateTokenParams(
        room=room_id,
        identity="user-42",
        permissions=TokenPermissions(join=True, subscribe=True, publish=True),
        expires_in=3600,
    )
)
# {"token": ..., "endpoint": ..., "iceServers": [...], "expiresAt": ...}
```

## Chat

The important method is `create_token()` — the whole security model
rests on it. Your backend authenticates the user its own way, then asks
Raven for a token scoped to that one user. Only that token reaches the
browser.

```python
from raven import CreateChatTokenParams, CreateConversationParams, ConversationMember, SendChatMessageParams

conversation = raven.chat.create_conversation(
    CreateConversationParams(
        name="support-room-42",
        members=[ConversationMember(user_id="alice", role="ADMIN"), ConversationMember(user_id="bob")],
    )
)

token = raven.chat.create_token(
    CreateChatTokenParams(user_id=request.user.id, conversations=[conversation["publicId"]], expires_in=3600)
)
# Hand token["token"] to the browser. Nothing else.
```

Membership, moderation, and messages:

```python
raven.chat.add_member(room, "carol", role="MODERATOR")
raven.chat.remove_member(room, "carol")

raven.chat.send_message(room, SendChatMessageParams(
    sender_id="system", text="Maintenance in 5 minutes", type="system", # server-only
))

page = raven.chat.list_messages(room, ListChatMessagesParams(limit=50))
raven.chat.delete_message("msg_abc")  # soft delete, keeps an audit trail
```

`room` accepts a `conv_...` id, the conversation's name, or the id of an
attached RTC room. `system` messages are server-only, because a browser
must never fabricate an official-looking announcement. Pass
`client_message_id` for the same idempotency guarantee described in
[Messages & Threads](/chat/messages#idempotency). Everything is mirrored
on `AsyncRaven.chat` with identical names.

## Errors

```python
from raven import RavenError

try:
    raven.rooms.get("missing-room")
except RavenError as error:
    print(error.code)         # e.g. "RAVEN_NOT_FOUND"
    print(error.status_code)  # e.g. 404
    print(error.request_id)   # matches the API's x-request-id
```

`RavenError` is built entirely from the parsed response body and
headers — never a stack trace from the server, a database error, or
RTC/TURN credentials. See [Error Codes](/reference/errors).

## Retries, timeouts, pagination

- **Retries**: transient failures only — network errors, timeouts, and
  429/502/503/504 — with bounded exponential backoff (`max_retries`,
  default 2). 400/401/403/404 and every other 4xx are never retried.
- **Timeouts**: `timeout` (seconds, default 10) bounds every request.
- **Pagination**: chat message history is cursor-paginated
  (`nextCursor`/`previousCursor`, opaque, no `offset`). Everything else
  returns a flat list, optionally capped with `limit`.

## Security

The API key lives only in a name-mangled attribute — never a plain
public attribute, never trivially visible via `vars()`/`repr()`. Never
logged, never included in a raised error. See
[Authentication](/getting-started/authentication).
