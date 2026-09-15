---
title: Install an SDK
description: One package for your backend, one for your client. Pick by platform.
---

Livqeno splits along one line: your **backend** holds the API key and mints
tokens; your **client** holds a token and joins. Those are different
packages, and neither can do the other's job.

> **The `@ravenkash/*` packages are on npm and the Flutter SDKs
> (`raven_rtc`/`raven_chat`/`raven_live`) are on pub.dev. The Python SDK
> is not on PyPI yet** — [contact support](mailto:support@mail.ravenstack.online)
> for early access.

## Your backend

<Tabs>
<Tab title="Node.js">

```bash
npm install @ravenkash/server
```

</Tab>
<Tab title="Python">

> **Not on PyPI yet.** It will publish as `livqeno-sdk`.
> [Contact support](mailto:support@mail.ravenstack.online) for early access;
> see [the Python SDK page](/sdk/python) for details.

```bash
pip install livqeno-sdk  # once published to PyPI
```

</Tab>
</Tabs>

## Your client

<Tabs>
<Tab title="Web">

```bash
npm install @ravenkash/rtc          # calls
npm install @ravenkash/chat         # messaging
npm install @ravenkash/client       # both, behind one object
```

</Tab>
<Tab title="React">

```bash
npm install @ravenkash/rtc @ravenkash/react
```

Add `@ravenkash/chat` for a chat panel, `@ravenkash/effects` for camera
filters. `@ravenkash/react` takes its Livqeno siblings as peer dependencies, so
your application chooses the versions and there is exactly one copy of each
in the tree.

</Tab>
<Tab title="React Native">

```bash
npm install @ravenkash/react-native @ravenkash/rtc \
            react-native-webrtc react-native-incall-manager

cd ios && pod install   # iOS only
```

`react-native-webrtc` is a required native module — autolinking needs it
installed directly in your app. You never import it yourself. See
[Permissions](/rtc/permissions) for the OS-level setup it also needs.
`react-native-incall-manager` is optional, for call-audio routing.

</Tab>
<Tab title="Flutter">

```yaml
dependencies:
  raven_rtc: ^0.1.0     # calls
  raven_chat: ^0.1.0    # messaging
  raven_live: ^0.1.0    # live streaming
```

</Tab>
</Tabs>

## Which package does what

| Package | Runs in | Holds |
|---|---|---|
| `@ravenkash/server` | Your backend | The API key |
| `livqeno-sdk` (Python) | Your backend | The API key |
| `@ravenkash/rtc` | Browser | An RTC token |
| `@ravenkash/chat` | Browser | A chat token |
| `@ravenkash/client` | Browser | Both, behind one `Raven` object |
| `@ravenkash/react` | Browser | Hooks over `rtc`/`chat`/`effects` |
| `@ravenkash/react-native` | iOS, Android | The same `Room` class as the web |
| `raven_rtc`, `raven_chat`, `raven_live` | iOS, Android | The same concepts, in Dart |
| `@ravenkash/effects` | Browser | Nothing — no credential needed |
| `@ravenkash/cli` | Your terminal | A dashboard session |

Full per-SDK reference in [SDKs](/sdk).

## Next steps

- [Generate a token](/get-started/first-token) — the first thing your backend does.
- [Browser support](/sdk/browser-support) — what is verified and what is not.
