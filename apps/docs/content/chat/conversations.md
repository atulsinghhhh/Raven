---
title: Conversations
description: Creating, listing, and updating conversations — a server-side operation, like every other resource that shapes a chat.
---

A conversation is the thing your app's users actually send messages
into — a support thread, a group channel, a DM, or the chat panel
attached to an RTC call. Creating and configuring one is server-side
only: a browser chat token can join a conversation and send messages in
it, but never create, rename, or reconfigure one. See
[Chat → Overview](/chat#authorization--two-independent-checks)
for why that split exists.

## Create

```ts
import { Raven } from '@ravenkash/server';
const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY,
  baseUrl: process.env.RAVEN_API_URL, // https://api.ravenstack.online
});

const conversation = await raven.chat.createConversation({
  name: 'support-room-42',
  members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
});
// { publicId: 'conv_9WcQ4kRz1nB2xYtL', name: 'support-room-42', type: 'CHANNEL', status: 'ACTIVE', ... }
```

```python
from raven import Raven, CreateConversationParams

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ["RAVEN_API_URL"],  # https://api.ravenstack.online
)
conversation = raven.chat.create_conversation(CreateConversationParams(name="support-room-42"))
```

Passing `roomId` attaches the conversation to an existing RTC room,
giving that call a chat panel — the two planes stay on separate
infrastructure either way; `roomId` is only ever the join key.
`members` seeds initial membership at creation; add or remove people
afterward with the calls on [Members](/chat/members).

A name must be unique within one project's environment — creating a
second conversation with a name already in use fails with a `409`, not
a silent duplicate.

## List and get

```ts
const conversations = await raven.chat.listConversations();
const one = await raven.chat.getConversation('support-room-42'); // or a conv_... id, or an attached room's id
```

```python
conversations = raven.chat.list_conversations()
one = raven.chat.get_conversation("support-room-42")
```

`getConversation`/`get_conversation` accepts any of the three forms
described in [Conversation references](/chat#conversation-references)
— the public id, the name, or an attached RTC room's id.

## Updating a conversation

Renaming, archiving, or changing retention isn't wrapped by a resource
method yet — call the REST endpoint directly with the same API key:

```bash
curl -X PATCH "$RAVEN_API_URL/v1/chat/conversations/support-room-42" \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"retentionDays": 30}'
```

See [REST API → Chat](/api) for the full field list.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `409` on create | A conversation with that `name` already exists in this project/environment. | Names are unique per environment — reuse the existing one via `getConversation()`, or pick a new name. |
| `404` on `getConversation`/`get_conversation` | Wrong environment, or the reference doesn't match any conversation/room. | Confirm you're passing the same environment the API key belongs to. |

## Production notes

- Treat `name` as a stable identifier your backend chooses, not
  something end users type — a support-ticket id or a room id, not raw
  user input.
- Prefer passing `roomId` at creation over attaching it later — there's
  no "attach after the fact" call.

## Related

- [Members](/chat/members) — add, remove, and list who's in a conversation.
- [Messages](/chat/messages)
