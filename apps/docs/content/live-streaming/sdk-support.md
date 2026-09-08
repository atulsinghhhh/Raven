---
title: SDK Support Matrix
description: What every Raven SDK implements for Live Streaming, and what's deliberately absent.
---

Every SDK exposes the same concepts — `LiveStream`, `Host`, `Co-host`,
`Viewer`, `Stream Status`, `Live Chat`, `Reaction` — over the same REST
API. What differs is which operations make sense for that runtime: a
mobile/web/Flutter SDK is a *client* (join, watch, publish, react) and
never mints its own credentials; a server SDK or the CLI is closer to
your backend and can create/manage streams, but only the server SDKs
(never the CLI) mint host/viewer credentials. See
[Security](#why-hosts-viewers-and-cli-differ) below for why.

A row is marked ✓ only where the capability is implemented **and**
covered by a test in this repo — never for something merely planned.

| Feature | Web | React | React Native | Flutter | Node.js | Python | CLI |
|---|---|---|---|---|---|---|---|
| Create stream | — ¹ | — ¹ | — ¹ | — ¹ | ✓ | ✓ | ✓ |
| Update / list / get stream | — ¹ | — ¹ | — ¹ | — ¹ | ✓ | ✓ | ✓ |
| Start / end stream | — ¹ | — ¹ | — ¹ | — ¹ | ✓ | ✓ | ✓ (end only) |
| Join as host | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Join as viewer | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Camera / microphone (host) | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Participants / viewer roster | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Live chat | ✓ | ✓ | ✓ | ✓ | ✓ ² | ✓ ² | — ³ |
| Reactions | ✓ | ✓ | ✓ | ✓ | — ⁴ | — ⁴ | — |
| Viewer count (live) | — ⁵ | — ⁵ | — ⁵ | — ⁵ | ✓ | ✓ | ✓ |
| Add / remove host | — | — | — | — | ✓ | ✓ | — ³ |
| Mint host credential | — | — | — | — | ✓ | ✓ | — ³ |
| Mint viewer credential | — | — | — | — | ✓ | ✓ | — ³ |

¹ A client SDK joins with credentials your backend already minted; it
never calls the stream-management endpoints directly.
² Server-side chat here means moderation/administration (post a system
message, manage membership) — not "join and read the live feed", which
is what the client SDKs' chat integration is for.
³ Deliberately absent — see below.
⁴ No server-side reaction-posting method yet; reactions are a client
action (`stream.react(emoji)`) today.
⁵ Client SDKs see the live RTC participant roster (`room.participants`),
which includes hosts. The authoritative viewer-only count (participants
minus registered hosts) is a backend concept, read via `get()`/`list()`
on the server SDKs or the CLI.

## Why hosts, viewers, and CLI differ

**Client SDKs never mint their own credentials.** Web, React, React
Native, and Flutter all *join* with a `LiveStreamCredentials` object
your backend produced — none of them can turn a viewer into a host, or
manufacture publish access, because none of them holds the project API
key that operation requires. This is the same reason a client SDK can
mint neither an RTC token nor a chat token.

**The CLI can manage a stream's lifecycle but not its credentials.** It
authenticates with a developer's login session (a JWT), the same as
`raven rooms`/`raven chat`. Creating, updating, and ending a stream leak
no secret in their response, so those are safe from a terminal.
`addHost()`/`createViewerToken()` mint a real, usable RTC + chat
credential — putting that behind a CLI command would mean a credential
capable of joining a live stream as its host could appear in shell
history or a CI log. That capability stays on `@ravenkash/server` and
`raven-sdk`, run from your own backend, exactly like `raven chat send`
and chat token minting never gained a CLI equivalent.

**Node.js and Python are equivalent.** `raven.liveStreams.addHost()` and
`raven.live_streams.add_host()` are the same operation, same guarantees,
naming translated to each language's convention — see
[Node.js SDK](/sdk/node) and [Python SDK](/sdk/python).

## Terminology

Every SDK uses the same words for the same things — `Stream`, `Host`,
`Co-host`, `Viewer`, `Stream Status`, `Live Chat`, `Reaction`. None of
them substitute a platform-specific term (no "Broadcast" on one SDK and
"LiveSession" on another) — a concept means the same thing whether you
read the docs for Flutter or for the CLI.

## Verification

- Web, Node.js, Python, and the CLI: exercised by this repo's automated
  test suites (`apps/api` Jest, `packages/server-sdk` Jest,
  `sdks/python` pytest, `packages/cli` Jest integration tests).
- React and React Native: exercised by `packages/react-sdk` and
  `packages/react-native-sdk`'s Jest suites, mocking the underlying
  RTC/chat clients.
- Flutter (`raven_live`): the credential-parsing logic
  (`RavenLiveStreamCredentials.fromJson`) has unit tests. The class
  methods that delegate to `raven_rtc`/`raven_chat` (`join`, `leave`,
  `react`) do not — this repo has no Flutter/Dart toolchain available to
  run them, and `raven_rtc` itself has the same gap for the same reason
  (its `Raven`/`RavenRoom` classes need a real or mocked signaling
  connection this repo's test setup doesn't provide). Run `flutter test`
  in an environment with the Flutter SDK installed before shipping.
