# Raven — Documentation Verification

**Date:** 2026-09-08
**Method:** followed the documented path end to end as a developer who has
never used Raven, checking every claim against the source tree.
**Scope:** `apps/docs` (140 pages), verified against `apps/api`,
`packages/*`, `sdks/*`, `services/sfu`, `scripts/*`.

---

## What was checked, and how

Two layers. Automated, over every page:

| Check | Scale | Result |
|---|---|---|
| `METHOD /v1/...` resolves to a real route | 180 | pass |
| `RAVEN_*` codes exist in a real vocabulary | 91 | pass |
| Imported symbols are exported by that package | 196 | pass |
| `raven <command>` is registered on the CLI | 100 | pass |
| Env vars are read by some component | 273 | pass |
| Internal links and heading anchors resolve | 907 | pass |
| Sidebar ↔ content parity, both directions | 140 | pass |

Written for this pass, on top of the committed harness:

| Check | Scale | Result |
|---|---|---|
| Every `receiver.method()` resolves to a declaration | 195 calls | pass (19 non-Raven built-ins skipped) |
| Server-SDK calls resolved **receiver-aware** to the right resource class | 137 | pass |
| Object-literal parameter keys against the real param interface | 118 | pass |
| Documented CLI flags against registered options | 22 | pass |
| Webhook payload shapes against every `emit()` call site | 15 events | **1 mismatch** |

Manual, following the 13 steps in order.

## Placeholder and fake-content scan

| Pattern | Hits | Verdict |
|---|---|---|
| `TODO`, `FIXME`, `XXX`, `HACK` | 0 | clean |
| "coming soon", "TBD", "WIP", "lorem ipsum" | 0 | clean |
| "placeholder" | 2 | both legitimate — a Flutter widget property and an HTML `placeholder` attribute |
| `example.com` / `.example` hosts | 13 | all RFC 2606 reserved names, used for *the reader's* domain |
| `localhost:4100` | 24 | correct — matches `API_PORT` in `.env.example` and `docker-compose.yml` |
| `rvk_` literals | 13 | all non-functional; the example secret base64-decodes to `hopeyouarehavingalovelyd` |
| Old package scope `@corvidhq/*` | 0 in docs | see HIGH-4 — stragglers remain in build artifacts |
| `livekit` | 9 | all in the migration guide, where it is the subject |

---

# Findings

## CRITICAL

### CRITICAL-1 — Step 1 of the documented path cannot be completed

**Severity:** CRITICAL
**Page:** `getting-started/quickstart`, `get-started/create-a-project`
**Problem:**
The quickstart opens with "Register in the Raven dashboard and create a
project", then `raven login`. A reader following it in order hits three
dead ends at once:

1. **No dashboard URL, and no statement that one is needed.** No content
   page links to a dashboard. The only route is an unlabelled top-bar link
   built from `NEXT_PUBLIC_DASHBOARD_URL`, which a reader has no reason to
   look for.
2. **`raven` is not a command they have.** The CLI is unpublished, stated
   on `sdk/cli` and `get-started/install-an-sdk` — both of which come
   *after* the quickstart.
3. **No mention that Raven must be running somewhere.** Raven is
   self-hostable; the quickstart silently assumes a deployment exists.

Every one of the remaining twelve steps depends on the API key this step
produces, so the whole path is blocked.

**Actual implementation:**
Three routes to a credential exist, all real, none signposted here:
- A hosted deployment's dashboard (`DASHBOARD_URL`, `http://localhost:3000`
  by default in `DocsNav.tsx`).
- The CLI, installed from a checkout — `getting-started/installing-from-source`.
- **`pnpm db:seed`**, which is the fastest by a wide margin.
  `apps/api/prisma/seed.ts` creates a demo developer, project, room *and*
  API key, and prints the key: `API key (shown once — this run only): …`.

**Recommended fix:**
Give the quickstart a prerequisites block naming the two situations (you
have a deployment / you are running one locally), link
`installing-from-source` and `self-hosting/docker-compose`, and surface
`pnpm db:seed` as the zero-to-credential path. Same for
`get-started/create-a-project`'s "From the dashboard" section, which should
say *which* dashboard.

**Status: FIXED.**

---

## HIGH

### HIGH-1 — Documented `live_stream.started` payload is wrong

**Severity:** HIGH
**Page:** `live-streaming/events`
**Problem:** The example envelope shows
`"data": { "streamId": "…", "title": "Friday Q&A" }` for
`live_stream.started`. A reader writing `event.data.title` on that event
gets `undefined`.

**Actual implementation:**
`apps/api/src/modules/live-streams/live-streams.service.ts` — every payload,
verified at its emit site:

| Event | `data` fields |
|---|---|
| `live_stream.created` | `streamId`, `title`, `visibility`, `hostIdentity`, `createdAt` |
| `live_stream.started` | `streamId`, `startedAt` |
| `live_stream.ended` | `streamId`, `endedAt`, `durationMs` (nullable) |
| `live_stream.host_joined` | `streamId`, `identity`, `role`, `at` |
| `live_stream.host_left` | `streamId`, `identity`, `at` |
| `live_stream.viewer_joined` | `streamId`, `identity`, `at` |
| `live_stream.viewer_left` | `streamId`, `identity`, `at` |

`title` appears on `created` only.

**Recommended fix:** Use a `created` payload for the example, and add the
per-event field table above — the fields differ enough that "additionally
carries `identity`" was not sufficient.

**Status: FIXED.**

---

### HIGH-2 — "The environment is inside the key" states the wrong mechanism

**Severity:** HIGH
**Page:** `get-started/api-credentials`, `concepts/environment`, `concepts/api-key`
**Problem:**
`api-credentials` says: "The environment is **inside the key**. A
development key cannot reach production data however it is asked, because
the environment is not something a request can specify."
`concepts/environment` says: "the environment is part of the key itself
(`rvk_prod_...`)".

The **conclusion** is correct. The **mechanism** is not, and it is a
security claim, so the difference matters. A reader could reasonably
conclude the prefix is authoritative — that parsing it is meaningful, or
that a key without a segment is malformed.

**Actual implementation:**
`shared/utils/crypto.util.ts` is explicit:

> The environment segment (`rvk_prod_...`) is there so a developer can tell
> at a glance which environment a key belongs to. It is **decoration for
> humans, not a claim**: authentication reads the environment from the key's
> row, so editing the prefix changes nothing. Keys minted before this
> existed have no segment and keep working.

`schema.prisma` calls `ApiKey.environment` "the single source of truth", and
`ApiKeysService.verify()` returns `apiKey.environment` from the row — the
string is never parsed. Confirmed by `prisma/seed.ts`, which mints
`rvk_${nanoid()}` with **no** segment, and those keys authenticate normally.

**Recommended fix:** Keep the guarantee, correct the mechanism: the
environment is a property of the key's record, the prefix is a human-readable
label, and a key without one is valid.

**Status: FIXED.**

---

### HIGH-3 — Example lockfiles still pin the old package scope

**Severity:** HIGH
**Page:** `examples` (and every guide that points at `examples/*`)
**Problem:** `examples.md` tells readers each example is "a real, runnable
app". The repo-wide rename from `@corvidhq/*` to `@ravenkash/*` updated each
example's `package.json` but **not** its `package-lock.json`:

| Example | `package.json` | `package-lock.json` |
|---|---|---|
| `examples/node-server` | `@ravenkash/server` | 3 × `@corvidhq/*` |
| `examples/chat` | `@ravenkash/*` | 15 × `@corvidhq/*` |
| `examples/react-video-call` | `@ravenkash/*` | 19 × `@corvidhq/*` |

`npm ci` fails outright when a lockfile disagrees with its manifest.
Vendored SDK bundles under `examples/*/raven-*.js` and
`apps/api/test/e2e-harness/vendor/` also still carry the old scope, as does
the root `pnpm-lock.yaml`.

**Actual implementation:** Package names are `@ravenkash/*` — confirmed from
all eight `packages/*/package.json`.

**Recommended fix:** Not a documentation change. Regenerate the lockfiles
and re-vendor the bundles as part of the rename
(`pnpm install`, `pnpm --filter "./packages/*" run build`, refresh the
`examples/*` locks). Until then `examples.md` overstates "runnable".

**Status: PARTIALLY FIXED.** The documentation now warns readers on
`examples` and records it in `reference/known-limitations`. The lockfiles
themselves are **not** regenerated: that means rewriting build artifacts and
a root lockfile currently carrying someone else's in-flight rename, and
doing it here would entangle two changes.

---

## MEDIUM

### MEDIUM-1 — Token refresh is exposed on Flutter only

**Severity:** MEDIUM
**Page:** `guides/handle-reconnection`, `rtc/reconnection`
**Problem:** The guide's only answer to a `failed` connection is "mint a
new token and rejoin". That is correct for the web and React Native SDKs
but not the whole picture: Flutter has a supported refresh hook, and a
reader on Flutter is being told to do more work than necessary.

**Actual implementation:** `signaling-client.ts` accepts
`refreshToken?: () => Promise<string>` and calls it before a reconnect
attempt — but `RTCClientConfig` does not expose it, so it is unreachable
from `@ravenkash/rtc` or `@ravenkash/react-native`. `raven_rtc`'s `Raven`
constructor **does** take `refreshToken`.

**Recommended fix:** Document the asymmetry, the same way
`requestLayer()` is already documented as Flutter-only. Do **not** add the
option to `RTCClientConfig` — that is a product change.

**Status: FIXED** — documented on `guides/handle-reconnection` and in
`reference/known-limitations`. The option was **not** added to
`RTCClientConfig`; that is a product change.

### MEDIUM-2 — `db:seed` printing an API key is under-signposted

**Severity:** MEDIUM
**Page:** `self-hosting/docker-compose`, `getting-started/quickstart`
**Problem:** Both list `pnpm db:seed` as "optional: a demo developer,
project, key, and room" without saying it **prints a usable API key**. It is
the shortest real path from a clean checkout to a working credential.
**Actual implementation:** `prisma/seed.ts` logs the login, project, room
and `API key (shown once — this run only)`.
**Recommended fix:** Say what it prints.
**Status: FIXED** as part of CRITICAL-1.

### MEDIUM-3 — Examples call undefined application helpers

**Severity:** MEDIUM
**Page:** ~15 pages
**Problem:** Snippets call `showPermissionHelp()`, `appendChat()`,
`enqueue()`, `wireUp()`, `setQuality()` and similar without marking them as
the reader's own code. Copying a block verbatim gives a `ReferenceError`.
**Actual implementation:** No such functions exist in Raven, nor should they.
**Recommended fix:** A short convention note on `guides`, or an inline
`// your function` on first use per page.
**Status: NOT FIXED — reported.** Ordinary documentation practice, but worth
one sentence of convention.

---

## LOW

### LOW-1 — CLI output sample differs by one character
**Page:** `production/environments` · **Problem:** the sample shows
"Keep it server-side — never in an app bundle"; `keys/create.ts` prints
"Keep it server-side; never in an app bundle". **Fix:** match the semicolon.
**Status: NOT FIXED.**

### LOW-2 — Two placeholder-host conventions
**Page:** several · **Problem:** Raven's own host is
`api.your-raven-deployment.example`, the reader's is `api.example.com`. The
distinction is deliberate and useful but never stated. **Fix:** one line in
`api/conventions`. **Status: NOT FIXED.**

### LOW-3 — The dated audit was caught by the global rename
**Page:** `docs/DOCUMENTATION_AUDIT.md` · **Problem:** a document dated
2026-09-08 describing the then-current state now cites `@ravenkash/*`, a
scope that did not exist when it was written. **Fix:** a note that the scope
was renamed after it was written. **Status: NOT FIXED.**

### LOW-4 — Example API-key secret is shorter than a real one
**Page:** `get-started/api-credentials` and others · **Problem:** the
example secret is 35 characters; `generateApiKeySecret()` produces 43
(`randomBytes(32).toString('base64url')`). **Fix:** none needed — an
obviously-fake secret is the safer choice. **Status: WON'T FIX, recorded.**

---

## Steps 1–13: verification result

| Step | Verified against | Result |
|---|---|---|
| 1. Create a project | CLI `projects create`, dashboard routes | **CRITICAL-1** — path blocked |
| 2. Install the SDK | all 8 `package.json` names, peer deps | pass |
| 3. Authenticate | `RavenClientOptions`, Python `Raven.__init__` | pass |
| 4. Generate a token | `CreateTokenParams`, `CreateRtcTokenDto`, `IssuedToken` | pass |
| 5. Connect | `RTCClientConfig`, `createRTCClient` | pass |
| 6. Join a room | `client.join`, `assertTokenMatchesRoom` (id or name) | pass |
| 7. Publish audio | `room.enableMicrophone` | pass |
| 8. Publish video | `room.enableCamera` | pass |
| 9. Receive a participant | all 17 `RoomEventMap` entries | pass |
| 10. Use chat | `createChatClient`, `ChatEventMap` (14), `MessagesApi` | pass |
| 11. Create a live stream | `LiveStreamsResource` (10 methods), `LiveStream.join` | pass |
| 12. Receive events | 17 RTC + 14 chat + 15 webhook | pass |
| 13. Configure webhooks | `CreateWebhookDto`, headers, envelope, retry constants | **HIGH-1** on one payload |

Verified exactly, worth recording because each is a number a reader will
rely on: RTC token 30–21600s (default 600), chat token 3600s default /
21600s max, 50 participants per room, 4000-char messages, 4096-byte
metadata, 65536-byte chat frames, 25 MB attachments, presence TTL 45s,
typing TTL 7s, signaling heartbeat 30s with a 60s timeout, webhook 6
attempts / 10s base backoff / 5s timeout / auto-disable at 50 consecutive
failures, and the webhook envelope `{id, type, projectId, environment,
createdAt, data}` with `raven-signature` / `raven-event-id` /
`raven-event-type`.

---

## Two corrections to my own method

Recorded because both produced a wrong answer before they produced a right
one, and the second nearly went into this report as a finding.

1. **A bare method name is not a receiver.** My first parameter checker
   mapped `create` and `list` to whichever resource defined them last, and
   reported 30 failures — every one a false positive. Re-resolving the
   receiver chain to its actual resource class dropped it to zero.
2. **`.requiredOption(` is not `.option(`.** A grep for registered CLI flags
   missed both, and I was one step from reporting `raven streams create
   --host` and `raven login --token` as invented flags. Both are real.

Neither documentation nor implementation was at fault in either case. The
checker was.
