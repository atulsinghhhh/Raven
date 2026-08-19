---
title: Hosts & Co-hosts
description: Adding and removing publish-capable participants — the creator is the first host, everyone else is invited.
---

Whoever creates a stream is registered as its first `HOST`. Anyone else
who should be able to publish audio/video is added explicitly:

```bash
curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/hosts \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"identity": "bob", "role": "CO_HOST"}'
```

```bash
curl -X DELETE https://api.raven.dev/v1/live-streams/$STREAM_ID/hosts/bob \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

## HOST vs. CO_HOST

Both can publish audio/video and moderate chat — the difference is
scope, not capability:

| | `HOST` | `CO_HOST` |
|---|---|---|
| Publish audio/video | ✓ | ✓ |
| Chat moderation scope | `ADMIN` | `MODERATOR` |
| Invite/remove other hosts | ✓ | — |

Removing a host is soft (`removedAt` is set); their existing RTC/chat
credentials aren't retroactively revoked, since tokens already expire
on their own — see [Authentication](/live-streaming/authentication).

## Joining as a host in the Web SDK

```ts
import { LiveStream } from '@corvidhq/client';

const stream = await LiveStream.join({
  streamId,
  role: 'HOST',
  rtc: credentials.rtc,
  chat: credentials.chat,
  chatRootMessageId,
});

await stream.room.enableCamera();
await stream.room.enableMicrophone();
```

`stream.isHost` is `true` for both `HOST` and `CO_HOST` — use
`stream.role` if you need to distinguish them.

## Next

- [Viewers](/live-streaming/viewers)
- [Moderation](/live-streaming/moderation)
