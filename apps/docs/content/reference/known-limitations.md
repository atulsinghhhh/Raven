---
title: Known limitations
description: What is not built, what is built but unverified, and what that means for you. Stated rather than left to be discovered.
---

Raven's documentation is only useful if it is honest about the edges. This
page is the list. Everything here comes from the repository's own testing
and deployment notes, not from guesswork.

## Not built

| Feature | Status |
|---|---|
| **Recording** | Nothing captures a room or stream to storage. No composite output, no per-track archive. |
| **RTMP ingest / egress** | No path in or out for external broadcast tooling. |
| **Billing, plans and paid usage** | Every account gets a fixed grant of 20,000 free RTC minutes, metered and enforced ([Usage](/concepts/usage)). Beyond that there is nothing: no plans, no payment path, no invoices, and no way to buy or be granted more minutes. The allowance does not reset. |
| **Metering beyond RTC minutes** | Chat, Live Streaming as a product, TURN bandwidth, storage and API requests are not counted at all. The [limits](/reference/limits) below are technical ceilings, not plan limits. |
| **Admin portal** | No administrative surface exists — no admin roles, no admin auth, and no endpoint that can grant, adjust or reset a developer's allowance. |
| **Active-speaker detection** | No event. Per-track statistics are available and can approximate it. |
| **Web-side simulcast layer selection** | The signaling protocol carries a `subscription.update` frame and `raven_rtc` exposes `RavenRoom.requestLayer(...)`, but `@ravenkash/rtc` neither sends the frame nor offers a method. Flutter only, today. |
| **Chat token revocation endpoint** | The service can revoke a token and the gateway checks for it, but no REST route, CLI command or SDK method triggers it. `TOKEN_REVOKED` is therefore reachable in principle and unreachable in practice. |
| **Web-side RTC token refresh** | The signaling client accepts a `refreshToken` callback and calls it before a reconnect, but `RTCClientConfig` does not expose it — so it is unreachable from `@ravenkash/rtc` and `@ravenkash/react-native`. `raven_rtc`'s `Raven` constructor **does** take it. On the web, handle a `failed` connection by minting a fresh token and rejoining. |
| **Early RTC token revocation** | By design — the short lifetime is the control, not a revocation list. |
| **Email change** | The address is the account key. |

## Built but unverified

These exist and appear to work. They have not been proven to the standard
the rest of the stack has, and that distinction is the point of this
section.

| Area | What is unproven |
|---|---|
| **Browser interop** | Only Chromium has been exercised with real media. Firefox, Safari and Edge are untested. Support is feature-detected, so an untested browser reports as supported — that is a claim about capabilities, not about interop. |
| **`turns:` over TLS, end to end** | The local certificate is self-signed, which Pion rejects for the same reason a browser would. Server-side TLS is verified separately; the full client path is not. |
| **Symmetric NAT** | The relay path is tested by forcing `iceTransportPolicy: relay`. A NAT that leaves no alternative is not what produced that test. |
| **Capacity** | Verified to 100 participants on loopback with synthetic media. That is not a capacity figure for real networks and real cameras, and is not quoted as one. |
| **Flutter runtime behaviour** | `raven_live`'s credential parsing has unit tests. The methods that delegate to `raven_rtc`/`raven_chat` do not — this repository has no Dart toolchain in CI. Run `flutter test` before shipping. |

## Incomplete implementations

| Area | Detail |
|---|---|
| **Congestion control** | The SFU collects TWCC feedback but nothing consumes it to drive layer selection. A subscriber on a degrading connection sees loss rather than an automatic downgrade. |
| **Server-side quality verdict** | `getConnectionQuality()` returns `'unknown'` rather than a client-side guess wearing a server's clothing. `getConnectionStats()` returns real measured per-track numbers. |
| **Simulcast on AV1 / H.265** | Keyframe detection covers VP8, VP9 and H.264; a layer switch cannot complete without it. Single-layer tracks in those codecs are fine. |
| **Participant join/leave history** | `rooms.participants.list()` reflects live media-server state, never a stored roster. `null` means the server was unreachable — not "empty". |
| **Live-stream analytics** | A live viewer count and a peak. No historical curve. |

## Deployment-level caveats

These are properties of how a deployment is configured, and they can
contradict what the rest of the documentation implies. Read them before
trusting an isolation claim.

### One database across environments defeats fleet isolation

`rtc_servers` is a single global table. If development, CI and production
share one database, a developer running the local stack registers a media
server into the **production** fleet.

That matters more than a noisy health check, because room allocation
prefers the requested region but **falls back to any region rather than
failing the call**. A production room can be allocated to a laptop, the
client is handed an address nothing can reach, and the call fails with no
obvious cause.

**Mitigation:** a separate database per environment. This is the single
highest-value thing to get right when self-hosting.

### Chat attachments need a storage driver your deployment actually has

Attachments require S3-compatible object storage. With no `STORAGE_BUCKET`
the API returns `RAVEN_NOT_CONFIGURED` rather than half-working — which is
the right behaviour, but it means [Attachments](/chat/attachments) describes
a feature your deployment may not have. Check before promising it.

### Webhook SSRF protection is hostname-level only

Raven refuses non-HTTP schemes, loopback and private-range **literals**,
and production additionally requires `https://`. It does **not** resolve
DNS, so a hostname resolving to a private address passes, as does a
redirect to one.

**Mitigation:** egress-filter the delivery worker at the network level.

### coturn can fail open

coturn's behaviour with an unreadable configuration file is to start
without it, which can mean an open relay. Treat a config parse error as a
hard failure in your own deployment tooling.

### Authenticated REST throughput is bounded by password hashing

bcrypt runs on the event loop. Measured at roughly 13 requests/second for
authenticated REST on the reference deployment. This affects
dashboard-session routes, not token minting or the media path.

## How to read this page

Nothing here is a promise about when it changes. It is a description of
what is true now, so you can decide whether Raven fits what you are
building — and so that if you hit one of these, you recognise it instead of
debugging your own code for a day.

If something you need is on this list, that is worth knowing before you
start, not after.

## Next steps

- [Production checklist](/production/checklist) — what to do about the ones that apply to you.
- [Build for production](/guides/build-for-production) · [Troubleshooting](/troubleshooting)
