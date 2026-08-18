---
title: Reconnection & Network Quality
description: What happens when the network drops, and how much control you have over it.
---

The SDK surfaces LiveKit's own reconnect policy — exponential backoff
with a capped retry delay, then a clean `failed` state — rather than
reimplementing reconnect logic on top of it.

```ts
createRTCClient({ token, endpoint, autoReconnect: true }); // default
```

- **`autoReconnect: true`** (default): automatic reconnect on network
  loss, surfaced as `reconnecting` → `reconnected` — or `disconnected`
  plus an `error` event with code `CONNECTION_FAILED` if every retry is
  exhausted.
- **`autoReconnect: false`**: the first disconnect goes straight to
  `disconnected`. No retries.

```ts
room.on('reconnecting', () => showBanner('Reconnecting…'));
room.on('reconnected', () => hideBanner());
room.on('error', (error) => {
  if (error.code === 'CONNECTION_FAILED') {
    showError('Lost the connection. Try rejoining.');
  }
});
```

## What a reconnect looks like to a participant

Tracks stay subscribed through a brief reconnect — you generally don't
need to re-attach media elements. A `disconnected` → `failed` transition
is the signal that the room needs to be rejoined from scratch, not
merely reconnected.

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

If you're on the dashboard side rather than in the client, the same
numbers are already flowing into Raven's own telemetry — see
[Event Catalogue](/reference/events) and `raven connections inspect`.
