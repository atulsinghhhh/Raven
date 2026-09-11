---
title: Hosts & Co-hosts
description: Adding and removing publish-capable participants — the creator is the first host, everyone else is invited.
---

Whoever creates a stream is registered as its first `HOST`. Anyone else
who should be able to publish audio/video is added explicitly:

<Tabs>
<Tab title="Node.js">

```ts
const credential = await raven.liveStreams.addHost(streamId, { identity: 'bob', role: 'CO_HOST' });
await raven.liveStreams.removeHost(streamId, 'bob');
```

</Tab>
<Tab title="Python">

```python
from raven import AddHostParams

credential = raven.live_streams.add_host(stream_id, AddHostParams(identity="bob", role="CO_HOST"))
raven.live_streams.remove_host(stream_id, "bob")
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST "$RAVEN_API_URL/v1/live-streams/$STREAM_ID/hosts" \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"identity": "bob", "role": "CO_HOST"}'

curl -X DELETE "$RAVEN_API_URL/v1/live-streams/$STREAM_ID/hosts/bob" \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

</Tab>
</Tabs>

**Not in the CLI or dashboard.** Minting a host credential is a
privileged, backend-only call — `raven streams` deliberately has no
`hosts add`/`hosts remove` command, the same reasoning that keeps chat
token minting out of the CLI. See
[SDK Support Matrix](/live-streaming/sdk-support#why-hosts-viewers-and-cli-differ).

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

## Joining as a host

<Tabs>
<Tab title="Web">

```ts
import { LiveStream } from '@ravenkash/client';

const stream = await LiveStream.join(credentials); // role: 'HOST' or 'CO_HOST'

await stream.room.enableCamera();
await stream.room.enableMicrophone();
```

</Tab>
<Tab title="React">

```tsx
import { useLiveStreamHost } from '@ravenkash/react';

const { camera, microphone, isHost } = useLiveStreamHost();
await camera.enable();
```

Throws if called for a `VIEWER`-role stream — pick
`useLiveStreamViewer()` for that case instead of branching on `isHost`
yourself.

</Tab>
<Tab title="React Native">

```ts
import { joinLiveStream } from '@ravenkash/react-native';

const stream = await joinLiveStream(credentials);
await stream.room.enableCamera();
```

</Tab>
<Tab title="Flutter">

```dart
final stream = await RavenLiveStream.join(credentials);
await stream.room.enableCamera();
```

</Tab>
</Tabs>

`isHost` is `true` for both `HOST` and `CO_HOST` on every SDK — check
`role` if you need to distinguish them.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `RAVEN_STREAM_INVALID_STATE` on `addHost`/`removeHost` | The stream has already `ENDED`. | An ended stream can't be modified — create a new one. |
| `RAVEN_STREAM_NOT_FOUND` on `removeHost` | The identity was never added, or already removed. | `removeHost` is idempotent-adjacent, not silent — check the hosts list via `get()`/`inspect` first. |

## Production notes

- Re-inviting a previously-removed host (calling `addHost` again with
  the same identity) reactivates them and mints fresh credentials — use
  this to rotate a host's token rather than tracking expiry yourself.
- Only ever call `addHost` from your own backend, after your own
  authorization check — it's the sole path to publish access on a stream.

## Related

- [Viewers](/live-streaming/viewers)
- [Moderation](/live-streaming/moderation)
- [SDK Support Matrix](/live-streaming/sdk-support)
