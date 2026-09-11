---
title: SDKs
description: Eight packages across six languages. Which one you need, and what each supports.
---

Livqeno splits along one line: your **backend** holds the API key and mints
[tokens](/concepts/token); your **client** holds a token and connects.
Those are different packages and neither can do the other's job.

## Pick by where the code runs

| Package | Runs in | Holds | Reference |
|---|---|---|---|
| `@ravenkash/server` | Your Node backend | API key | [Node.js](/sdk/node) |
| `raven-sdk` | Your Python backend | API key | [Python](/sdk/python) |
| `@ravenkash/rtc` | Browser | RTC token | [Web](/sdk/web) |
| `@ravenkash/chat` | Browser | Chat token | [Web](/sdk/web) |
| `@ravenkash/client` | Browser | Both, behind one object | [Livqeno Client](/sdk/client) |
| `@ravenkash/react` | Browser | Hooks over the above | [React](/sdk/react) |
| `@ravenkash/react-native` | iOS, Android | RTC + chat | [React Native](/sdk/react-native) |
| `raven_rtc`, `raven_chat`, `raven_live` | iOS, Android | RTC / chat / streaming | [Flutter](/sdk/flutter) |
| `@ravenkash/effects` | Browser | Nothing — no credential | [Effects](/effects) |
| `@ravenkash/cli` | Your terminal | Dashboard session | [CLI](/sdk/cli) |

## Stability

**Every package is at `0.1.0` and none is published to a registry.**

Treat every SDK signature as pre-1.0 and subject to change. The two wire
protocols and the REST API are more settled than the SDKs that wrap them —
see [Changelog](/reference/changelog) for what each surface promises.

Install from a checkout until the first release:
[Installing from source](/getting-started/installing-from-source).

## Feature support

✓ means implemented **and** covered by a test in the repository. Never for
something merely planned.

| | Web | React | React Native | Flutter | Node | Python | CLI |
|---|---|---|---|---|---|---|---|
| Mint tokens | — | — | — | — | ✓ | ✓ | — |
| Join a room | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Camera / microphone | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Screen sharing | ✓ | ✓ | — ¹ | ✓ | — | — | — |
| Device selection | ✓ | ✓ | ✓ | ✓ ² | — | — | — |
| Data messages | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Diagnostics / stats | ✓ | ✓ | ✓ | — ³ | — | — | ✓ |
| Simulcast layer control | — ⁴ | — ⁴ | — ⁴ | ✓ | — | — | — |
| Chat | ✓ | ✓ | ✓ | ✓ | ✓ ⁵ | ✓ ⁵ | — ⁶ |
| Live streaming | ✓ | ✓ | ✓ | ✓ | ✓ ⁵ | ✓ ⁵ | ✓ ⁷ |
| Camera effects | ✓ | ✓ | — ⁸ | — ⁸ | — | — | — |
| Rooms / streams management | — | — | — | — | ✓ | ✓ | ✓ |
| Observability | — | — | — | — | ✓ | ✓ | ✓ |

¹ The platform cannot capture the screen. Not a Livqeno gap.
² `switchCamera()` — front/rear, which has no web equivalent.
³ `RavenRoom` exposes no stats method yet.
⁴ Flutter only; the frame exists in the protocol. [Details](/reference/known-limitations).
⁵ Server-side administration — create conversations, post messages, mint credentials. Not "join and read the live feed".
⁶ Read-only: the CLI holds a dashboard session, not an API key.
⁷ Lifecycle only. Minting credentials stays on the server SDKs.
⁸ Filter and preset **configuration** is real and shared; the native frame-processing engine is not shipped.

## One vocabulary, several syntaxes

A `Room` on the web is the same class as a `Room` in React Native. A
`RavenRoom` in Dart is the same concepts with Dart syntax. No SDK
substitutes a platform-specific term — there is no "Broadcast" on one and
"LiveSession" on another.

No SDK exposes a WebRTC type. `RTCPeerConnection`, `RTCRtpSender` and
friends stay internal, on every platform. The one deliberate exception is
`track.mediaStreamTrack`, for when you genuinely need to go deeper.

## What every SDK guarantees

- The API key lives in a private field. Never enumerable, never in
  `JSON.stringify()` or a Python `repr()`.
- No credential is logged, at any level.
- No credential appears in a thrown error. Errors carry
  `{message, code, requestId}`.
- Errors are typed. Never a raw `DOMException`, never a raw HTTP body.

## Next steps

- [Install an SDK](/get-started/install-an-sdk) — the commands.
- [Browser support](/sdk/browser-support) — what is verified, and what is not.
