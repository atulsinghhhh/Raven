---
title: Changelog
description: How Livqeno versions its packages, and where release notes come from.
---

## Current versions

The `@ravenkash/*` JavaScript/TypeScript packages are published to npm and
version independently — see "How versioning will work" below for why the
numbers don't match across packages:

| Package | Registry |
|---|---|
| `@ravenkash/rtc` | [npm](https://www.npmjs.com/package/@ravenkash/rtc) |
| `@ravenkash/chat` | [npm](https://www.npmjs.com/package/@ravenkash/chat) |
| `@ravenkash/client` | [npm](https://www.npmjs.com/package/@ravenkash/client) |
| `@ravenkash/effects` | [npm](https://www.npmjs.com/package/@ravenkash/effects) |
| `@ravenkash/react` | [npm](https://www.npmjs.com/package/@ravenkash/react) |
| `@ravenkash/react-native` | [npm](https://www.npmjs.com/package/@ravenkash/react-native) |
| `@ravenkash/server` | [npm](https://www.npmjs.com/package/@ravenkash/server) |
| `@ravenkash/cli` | [npm](https://www.npmjs.com/package/@ravenkash/cli) |
| `raven_rtc`, `raven_chat`, `raven_live` | Unpublished (pub.dev) |
| `raven-sdk` | Unpublished (PyPI) |

For Python and Flutter, install from a checkout —
[Installing from source](/getting-started/installing-from-source).

This page doesn't pin exact version numbers — check the npm link for each
package's current `latest` tag. It will carry real per-version release
notes once changesets accumulate enough of them to be worth reading.

## How versioning will work

Packages version **independently**. A patch to the CLI does not drag
`@ravenkash/rtc` to a new version containing no changes — you install them
separately, so a shared version number would be a claim the project cannot
back up.

Each change that affects a published package carries a written note
describing it, and those notes become the release notes. Nothing publishes
without one.

## What "stable" will mean

Two surfaces are versioned separately from the packages, and it is worth
knowing which is which:

| Surface | Stability today |
|---|---|
| REST API (`/v1`) | Additive changes only. New fields may appear; ignore ones you do not recognise |
| Error codes | `RAVEN_*` codes are stable. `legacyCode` is deprecated and will be removed |
| Chat WebSocket frames | A published protocol, versioned independently of the SDK |
| RTC signaling frames | A published protocol, versioned independently of the SDK |
| SDK APIs | **Pre-1.0.** Treat every signature as subject to change |

The two wire protocols keep their own error vocabularies precisely so they
can version without the REST API having to.

## Where to watch for changes

- The repository's release notes, once the first release lands.
- [Known limitations](/reference/known-limitations) — the honest list of
  what is not finished, updated as things land.

## Next steps

- [Known limitations](/reference/known-limitations)
- [Installing from source](/getting-started/installing-from-source)
