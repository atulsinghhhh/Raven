---
title: Network Quality
description: A stream's host and viewers sit on ordinary RTC rooms — the same reconnection and quality model applies, with one stream-specific wrinkle.
---

A live stream doesn't have its own network-quality system — hosts and
viewers are RTC room participants, so everything in
[RTC → Reconnection & Network Quality](/rtc/reconnection) applies
directly: automatic reconnect with exponential backoff,
`reconnecting`/`reconnected` events, and `room.getConnectionStats()`
for a live quality signal.

<Tabs>
<Tab title="Web">

```ts
stream.room.on('reconnecting', () => showBanner('Reconnecting…'));
stream.room.on('reconnected', () => hideBanner());
```

</Tab>
<Tab title="React">

```tsx
import { useConnectionState } from '@ravenkash/react';

const state = useConnectionState(); // works inside <RavenLiveStream> — same as any RavenRoom
```

</Tab>
<Tab title="React Native">

```ts
stream.room.on('reconnecting', () => showBanner('Reconnecting…'));
```

</Tab>
<Tab title="Flutter">

```dart
stream.room.connectionStateChanges.listen((state) {
  if (state == RavenConnectionState.reconnecting) showBanner('Reconnecting…');
});
```

</Tab>
</Tabs>

## The one stream-specific wrinkle

An RTC reconnect resumes the same room session automatically. It does
not mint you a new token — if a viewer's or host's RTC/chat token
expires while they're disconnected, reconnecting the room succeeds but
rejoining will still need a fresh token from
[the viewer-token or host endpoint](/live-streaming/authentication)
the next time one is required. There's no automatic token refresh
built into `LiveStream` today.

## Next

- [RTC → Reconnection & Network Quality](/rtc/reconnection)
- [Analytics](/live-streaming/analytics)
