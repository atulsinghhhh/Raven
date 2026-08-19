---
title: Conversations
description: Creating, listing, and updating conversations — a server-side operation, like every other resource that shapes a chat.
---

A conversation is the thing your app's users actually send messages
into — a support thread, a group channel, a DM, or the chat panel
attached to an RTC call. Creating and configuring one is server-side
only: a browser chat token can join a conversation and send messages in
it, but never create, rename, or reconfigure one. See
[Chat → Overview](/chat/overview#authorization--two-independent-checks)
for why that split exists.

## Create

```ts
import { Raven } from '@raven/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

const conversation = await raven.chat.createConversation({
  name: 'support-room-42',
  members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
});
// { publicId: 'conv_9WcQ4kRz1nB2xYtL', name: 'support-room-42', type: 'CHANNEL', status: 'ACTIVE', ... }
```

```python
from raven import Raven, CreateConversationParams

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])
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
described in [Conversation references](/chat/overview#conversation-references)
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

See [REST API → Chat](/server/rest-api) for the full field list.

## Next

- [Members](/chat/members) — add, remove, and list who's in a conversation.
- [Messages](/chat/messages)
