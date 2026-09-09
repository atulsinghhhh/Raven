---
title: Changelog
description: How Raven versions its packages, and where release notes come from.
---

## Nothing is published yet

Every Raven package sits at **`0.1.0`** and none has been published to a
registry:

| Package | Version | Registry |
|---|---|---|
| `@ravenkash/rtc` | 0.1.0 | Unpublished |
| `@ravenkash/chat` | 0.1.0 | Unpublished |
| `@ravenkash/client` | 0.1.0 | Unpublished |
| `@ravenkash/effects` | 0.1.0 | Unpublished |
| `@ravenkash/react` | 0.1.0 | Unpublished |
| `@ravenkash/react-native` | 0.1.0 | Unpublished |
| `@ravenkash/server` | 0.1.0 | Unpublished |
| `@ravenkash/cli` | 0.1.0 | Unpublished |
| `raven_rtc`, `raven_chat`, `raven_live` | 0.1.0 | Unpublished (pub.dev) |
| `raven-sdk` | 0.1.0 | Unpublished (PyPI) |

Until the first release, install from a checkout —
[Installing from source](/getting-started/installing-from-source).

This page will carry release notes once there are releases to note. Saying
so is more useful than an empty table implying a history that does not
exist.

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
