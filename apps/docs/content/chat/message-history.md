---
title: Message History
description: Cursor-paginated, newest first — and why there's no offset parameter.
---

<Tabs>
<Tab title="Web">

```ts
const page = await chat.messages.list({ room: 'conv_9WcQ…', limit: 50 });
// { data: [...], nextCursor: '...', previousCursor: '...', hasMore: true }

const older = await chat.messages.list({ before: page.nextCursor });
const newer = await chat.messages.list({ after: page.previousCursor });
```

</Tab>
<Tab title="React">

```tsx
const { messages, loadMore, loading, hasMore } = useMessages();
<button onClick={() => loadMore()} disabled={!hasMore || loading}>Load earlier</button>
```

`<RavenChat>` already loads the first page (default 50 messages) on
connect — `loadMore()` pages further back.

</Tab>
<Tab title="React Native">

```ts
const page = await raven.chat!.messages.list({ room: 'conv_9WcQ…', limit: 50 });
```

</Tab>
<Tab title="Flutter">

```dart
final page = await chat.history(limit: 50);
final older = await chat.history(before: page.nextCursor);
```

</Tab>
</Tabs>

Newest first. Cursors are opaque — pass back exactly what you were
given; they encode a timestamp and a **public** message id, never an
internal database id.

Offset pagination isn't merely discouraged here — there's no parameter
for it. `?offset=50000` makes the database walk and discard 50,000 rows
before returning anything, and in a live conversation an offset silently
shifts as new messages arrive between fetches, showing you a duplicate
or skipping one. A cursor points at a specific position, so it stays
valid no matter what arrives in between.

Other filters: `threadRootId` (see [Threads](/chat/threads)), `senderId`,
`includeDeleted`.

## Server-side history

A backend can read the same history for export or moderation, with a
project API key instead of a chat token:

```ts
import { Raven } from '@ravenkash/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

const page = await raven.chat.listMessages('support-room-42', { limit: 50 });
```

```python
from raven import ListChatMessagesParams

page = raven.chat.list_messages("support-room-42", ListChatMessagesParams(limit=50))
```

Same cursor semantics either way — a page fetched server-side and one
fetched from the browser paginate identically.

## Next

- [Threads](/chat/threads)
- [Messages](/chat/messages)
