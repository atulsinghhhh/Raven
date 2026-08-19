---
title: Viewers
description: Subscribe-only, and with no database row of their own — a viewer is just an SFU participant.
---

Viewers don't have a membership table like hosts do — anyone with a
valid viewer token can join, and "who's watching" is answered by asking
the SFU who's currently connected, not by querying a viewers table.

```bash
curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/viewer-tokens \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"identity": "carol"}'
```

## Joining in the Web SDK

```ts
const stream = await LiveStream.join({
  streamId,
  role: 'VIEWER',
  rtc: credentials.rtc,
  chat: credentials.chat,
  chatRootMessageId,
});

// Already-live tracks arrive synchronously; new ones fire trackSubscribed.
for (const participant of stream.room.remoteParticipants) {
  for (const track of participant.tracks) {
    if (track.kind === 'camera') track.attach(videoEl);
  }
}
stream.room.on('trackSubscribed', (track, participant) => {
  if (track.kind === 'camera') track.attach(videoEl);
});
```

## Leaving

```bash
curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/leave \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"identity": "carol"}'
```

```ts
await stream.leave();
```

## What a viewer can't do

A viewer's RTC token always has `publish: false` — there's no field on
the viewer-token request that changes that, so this isn't something a
client can request its way around. See
[Authentication](/live-streaming/authentication). A viewer can still
send chat messages and reactions with `MEMBER` scope; only publishing
media is off-limits.

## Next

- [Live Chat](/live-streaming/live-chat)
- [Reactions](/live-streaming/reactions)
