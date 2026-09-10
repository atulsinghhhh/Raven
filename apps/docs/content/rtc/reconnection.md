---
title: Reconnection & Network Quality
description: What happens when the network drops, and how much control you have over it — on every SDK.
---

The SDK surfaces Raven's own reconnect policy — exponential backoff
with a capped retry delay, then a clean `failed` state — rather than
reimplementing reconnect logic on top of it. The policy is identical
across platforms because it's the same underlying client.

<Tabs>
<Tab title="Web">

```ts
createRTCClient({ token, endpoint, autoReconnect: true }); // default
```

</Tab>
<Tab title="React Native">

```ts
new Raven({ token, endpoint, autoReconnect: true }); // default
```

Also watches connectivity via `@react-native-community/netinfo`
(optional dependency) — a Wi-Fi → cellular handover triggers a fast
reconnect nudge instead of waiting out a full ICE timeout:

```ts
new Raven({
  onNetworkReconnect: () => {
    // connectivity returned and the room is disconnected — a good moment
    // to show "reconnecting…" or force a rejoin if it doesn't recover
  },
});
```

</Tab>
<Tab title="Flutter">

```dart
Raven(token: token, endpoint: endpoint, autoReconnect: true); // default
```

</Tab>
</Tabs>

- **`autoReconnect: true`** (default): automatic reconnect on network
  loss, surfaced as `reconnecting` → `reconnected` — or `disconnected`
  plus an `error` event with code `CONNECTION_FAILED` if every retry is
  exhausted.
- **`autoReconnect: false`**: the first disconnect goes straight to
  `disconnected`. No retries.

<Tabs>
<Tab title="Web">

```ts
room.on('reconnecting', () => showBanner('Reconnecting…'));
room.on('reconnected', () => hideBanner());
room.on('error', (error) => {
  if (error.code === 'CONNECTION_FAILED') {
    showError('Lost the connection. Try rejoining.');
  }
});
```

</Tab>
<Tab title="React Native">

```ts
room.on('reconnecting', () => showBanner('Reconnecting…'));
room.on('reconnected', () => hideBanner());
```

The same `Room` events as web — `new Raven(...)` adds only the
connectivity-aware nudge above on top.

</Tab>
<Tab title="Flutter">

```dart
room.connectionStateChanges.listen((state) {
  if (state == RavenConnectionState.reconnecting) showBanner('Reconnecting…');
  if (state == RavenConnectionState.connected) hideBanner();
});
```

Streams, not an event emitter — the one place this SDK deliberately
diverges from the TypeScript one. See [Flutter SDK](/sdk/flutter#idiomatic-dart-identical-concepts).

</Tab>
</Tabs>

## What a reconnect looks like to a participant

Tracks stay subscribed through a brief reconnect — you generally don't
need to re-attach media elements. A `disconnected` → `failed` transition
is the signal that the room needs to be rejoined from scratch, not
merely reconnected.

Your own published tracks come back too. A reconnect gets a fresh SFU
session, and with it a fresh `RTCPeerConnection`, so the SDK re-publishes
whatever was live before the outage — microphone, camera, screen share —
and re-declares each source to the new session. You do not call
`enableCamera()` again, and nothing is published twice.

One exception, and it is deliberate: a **screen share whose capture ended
while you were disconnected is not restored**. Stopping a share is the
user's own doing, through browser UI the SDK never sees, and the track is
dead for good — re-publishing it would negotiate a stream that never
carries a frame. You get `localTrackUnpublished` for it instead, exactly
as if they had stopped sharing while connected.

## App lifecycle (React Native)

The SDK watches `AppState` and reports transitions, but deliberately
**does not disconnect on background** — dropping the socket on a brief
app-switch would turn "checked a notification" into "left the meeting."
Video capture does stop when backgrounded (the OS suspends the camera)
and resumes on return.

```ts
new Raven({
  onAppStateChange: (state) => {
    if (state === 'background') void raven.leave(); // your call, not automatic
  },
});
```

See [Background Audio](/rtc/background-audio) for keeping the call alive
(audio-only) while backgrounded, instead of leaving it.

## Watching quality in real time

`room.getConnectionStats()` gives you the numbers behind "how's this
call actually going" — see [Diagnostics](/rtc/diagnostics). A common
pattern is polling it to drive a quality indicator in your own UI:

```ts
setInterval(async () => {
  const stats = await room.getConnectionStats();
  updateQualityBadge(stats.connectionQuality); // 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'
}, 5000);
```

This works identically on Web and React Native (same `Room` class).

If you're on the dashboard side rather than in the client, the same
numbers are already flowing into Raven's own telemetry — see
[Event Catalogue](/reference/events) and `raven connections inspect`.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `CONNECTION_FAILED` | Every reconnect attempt was exhausted. | Rejoin from scratch — `client.join()`/`raven.join()` again with a fresh token if the old one has expired. |
| Reconnect never fires | `autoReconnect: false` was set. | Remove it, or handle `disconnected` yourself and call `join()` again. |

## Production notes

- Don't build your own retry loop around `join()` — you'd be racing the
  SDK's own reconnect logic. Listen for `failed` and rejoin then, not before.
- A `reconnecting` banner that never clears usually means the app
  crashed mid-reconnect, not that the SDK is stuck — check for an
  uncaught error nearby.

## Related

- [Diagnostics](/rtc/diagnostics) — `getConnectionStats()` in full.
- [Background Audio](/rtc/background-audio) — mobile-specific backgrounding behavior.
- [Troubleshooting](/rtc/troubleshooting) — connection failures that aren't a thrown error.
