# Raven — Documentation Audit

**Date:** 2026-09-08
**Scope:** Full repository + both documentation sets. Audit only, with one
exception: the code defect in §4.1 was fixed on request after the audit
landed. No documentation has been rewritten.
**Method:** the source tree is the source of truth. Every claim below was
checked against an actual controller, DTO, exported symbol, constant, or
config key. Where I could not verify something, it is marked
**NEEDS VERIFICATION** rather than guessed.

---

## 0. How to read this

Raven has **two separate documentation sets**, and that is the single most
important structural fact in this audit:

| Set | Path | Audience | Published? | Pages | Last substantive change |
|---|---|---|---|---|---|
| **Product docs** | `apps/docs/content/` | developers integrating Raven | Yes — Next.js site, `docs.ravenstack.online` | 79 `.md` | **2026-08-24** |
| **Internal docs** | `docs/` | contributors, operators, the author | No — GitHub only | 76 `.md` | **2026-09-08** |

Both sets are unusually high quality for a project this young. The problem
is not sloppiness; it is that **the published set stopped moving on
2026-08-24 while the code and the internal set kept going for another two
weeks.** Every "Outdated" verdict below traces back to that one gap.

Statuses used:

- **Correct** — verified against source, no discrepancy found.
- **Outdated** — was true, is no longer true.
- **Incomplete** — true as far as it goes, but omits a shipped surface.
- **Incorrect** — describes something that does not exist or behaves differently.
- **Duplicate** — substantially overlaps another page.
- **Needs restructuring** — content is fine, location/shape is wrong.
- **Missing** — no page exists.

---

## 1. What actually exists in the repository

### 1.1 Monorepo shape

pnpm workspace (`pnpm@11.22.0`, Node >= 20), workspaces are
`apps/*`, `packages/*`, `services/*`. `sdks/*` and `examples/*` are
**outside** the workspace (Flutter/Python/standalone demos).

```
apps/
  api             @raven/api            NestJS 10 control plane (private)
  dashboard       @raven/dashboard      Next.js developer dashboard (private)
  docs            @raven/docs           Next.js documentation site (private)
  www             @raven/www            Next.js landing page, 1 page (private)
  community       @raven-community/web  GITIGNORED WIP scaffold — untracked
  community-api   @raven-community/api  GITIGNORED WIP scaffold — untracked
packages/
  sdk             @ravenkash/rtc           browser RTC SDK
  chat-sdk        @ravenkash/chat          browser chat SDK
  client          @ravenkash/client        Raven facade (rtc + chat) + LiveStream
  effects         @ravenkash/effects       video effects pipeline
  react-sdk       @ravenkash/react         React hooks/components (+ ./chat entry)
  react-native-sdk @ravenkash/react-native React Native SDK
  server-sdk      @ravenkash/server        Node server SDK
  cli             @ravenkash/cli           `raven` binary
services/
  sfu             Go 1.26 / Pion WebRTC v4 SFU (no README)
sdks/
  flutter/raven_rtc, raven_chat, raven_live   (pub packages, v0.1.0)
  python/raven-sdk                            (PyPI name `raven-sdk`, import `raven`)
examples/  13 entries (12 runnable apps + cli-workflow.md)
infrastructure/  azure, docker, k8s
scripts/  load tests, k6, infra verify, TURN cert/relay tests
```

**Published package scope is `@ravenkash/*`, not `@raven/*`.** `@raven/*`
names are internal, private workspace apps only. The product docs get this
right everywhere.

### 1.2 REST API — verified route inventory

Extracted from every `@Controller` in `apps/api/src`. No global prefix;
Swagger UI at `/docs`. Four auth schemes: `jwt` (dashboard session),
`apiKey` (project key `rvk_<env>_xxx.secret`), `rtcToken`, `chatToken`.

**Auth / account (JWT or public)**
```
POST   /v1/auth/register            POST /v1/auth/login
POST   /v1/auth/verify-email        POST /v1/auth/verify-email/resend
POST   /v1/auth/password-reset      POST /v1/auth/password-reset/confirm
POST   /v1/auth/logout
GET    /v1/auth/oauth/providers
POST   /v1/auth/oauth/:provider/start
POST   /v1/auth/oauth/:provider/exchange
GET    /v1/users/me                 PATCH /v1/users/me
GET    /v1/onboarding               PATCH /v1/onboarding
POST   /v1/onboarding/complete
```

**Projects / members / keys / audit (JWT)**
```
POST|GET /v1/projects       GET|PATCH|DELETE /v1/projects/:id
GET|POST /v1/projects/:projectId/members
PATCH|DELETE /v1/projects/:projectId/members/:userId
POST|GET /v1/projects/:projectId/api-keys
DELETE /v1/projects/:projectId/api-keys/:keyId
GET    /v1/projects/:projectId/audit-logs
```

**Rooms + RTC tokens (API key)**
```
POST|GET /v1/rooms          GET|DELETE /v1/rooms/:id
GET    /v1/rooms/:id/participants
POST   /v1/rooms/:roomId/rtc-tokens
```

**Chat (API key OR chat token — one guard, two credentials)**
```
POST   /v1/chat/tokens
POST|GET /v1/chat/conversations
GET|PATCH /v1/chat/conversations/:room
POST|GET /v1/chat/conversations/:room/members
DELETE /v1/chat/conversations/:room/members/:userId
GET|POST /v1/chat/conversations/:room/messages
GET    /v1/chat/messages/:messageId
GET    /v1/chat/messages/:messageId/thread
PATCH|DELETE /v1/chat/messages/:messageId
POST   /v1/chat/messages/:messageId/reactions
DELETE /v1/chat/messages/:messageId/reactions/:emoji
POST   /v1/chat/messages/:messageId/read
GET    /v1/chat/conversations/:room/read-state
GET    /v1/chat/conversations/:room/read-receipts
GET    /v1/chat/conversations/:room/presence
GET    /v1/chat/conversations/:room/typing
POST   /v1/chat/conversations/:room/attachments
POST   /v1/chat/attachments/:attachmentId/complete
GET    /v1/chat/attachments/:attachmentId/download-url
```

**Live streams (API key)**
```
POST|GET /v1/live-streams   GET|PATCH /v1/live-streams/:streamId
POST   /v1/live-streams/:streamId/start
POST   /v1/live-streams/:streamId/end
POST   /v1/live-streams/:streamId/hosts
DELETE /v1/live-streams/:streamId/hosts/:identity
POST   /v1/live-streams/:streamId/viewer-tokens
POST   /v1/live-streams/:streamId/leave
```

**Server-facing observability (API key)** — used by both server SDKs
```
GET /v1/project
GET /v1/connections        GET /v1/connections/:connectionId
GET /v1/errors             GET /v1/errors/:errorId
GET /v1/metrics            GET /v1/diagnostics
```

**Dashboard-facing (JWT)**
```
GET|POST /v1/projects/:projectId/rooms   GET /v1/projects/:projectId/rooms/:roomId
POST /v1/projects/:projectId/rooms/:roomId/test-token
GET  /v1/projects/:projectId/chat/overview | conversations | connections
GET  /v1/projects/:projectId/chat/conversations/:id[/members|/messages|/presence]
POST|GET /v1/projects/:projectId/live-streams
GET|PATCH /v1/projects/:projectId/live-streams/:streamId
POST /v1/projects/:projectId/live-streams/:streamId/end
GET  /v1/projects/:projectId/connections[/:connectionId]
GET  /v1/projects/:projectId/errors[/:errorId]
GET  /v1/projects/:projectId/metrics    GET /v1/projects/:projectId/diagnostics
POST|GET /v1/projects/:projectId/webhooks
GET  /v1/projects/:projectId/webhooks/:webhookId/deliveries
PATCH|DELETE /v1/projects/:projectId/webhooks/:webhookId
GET  /v1/rtc/servers   GET /v1/rtc/servers/metrics   GET /v1/rtc/servers/:name
POST /v1/rtc/servers/:name/drain | /undrain
```

**SFU fleet (shared-secret guard)** and **infrastructure**
```
POST /v1/rtc/servers/register     PUT /v1/rtc/servers/:name/heartbeat
POST /v1/telemetry/events         (rtcToken)
GET  /health   /health/live   /health/ready   GET /metrics
```

### 1.3 WebSocket surfaces

| Plane | Path | Constants file |
|---|---|---|
| RTC signaling | `/v1/rtc` | `modules/signaling/signaling.constants.ts` |
| Chat | `/v1/chat/ws?token=…` | `modules/chat/chat.constants.ts` |

- Signaling client frames: `room.join`, `room.leave`, `sdp.answer`,
  `sdp.offer`, `ice.candidate`, `track.mute`, `track.publish`,
  `subscription.update`, `ping`.
- Signaling server frames: `room.joined`, `room.left`,
  `participant.joined`, `participant.left`, `track.published`,
  `track.unpublished`, `track.muted`, `track.unmuted`, `sdp.offer`,
  `sdp.answer`, `ice.candidate`, `connection.state`, `error`, `pong`.
- 15 `SignalingErrorCode` values, incl. `NO_RTC_CAPACITY`,
  `RTC_SERVER_UNREACHABLE`, `NEGOTIATION_FAILED`, `NEGOTIATION_GLARE`.
- Chat frames: 12 client, 15 server, 22 `ChatErrorCode` values, close
  codes 4401/4403/4429/4440/4500, heartbeat 25 s.

### 1.4 Webhooks — the real event list

`WEBHOOK_EVENT_TYPES` (`webhook-events.service.ts`), **15 events**, every
one verified to have a real `emit()` call site:

```
message.created  message.updated  message.deleted
reaction.added   reaction.removed
room.created     participant.joined  participant.left   ← emitted by CHAT
                                                          conversations, not RTC
live_stream.created   live_stream.started    live_stream.ended
live_stream.host_joined   live_stream.host_left
live_stream.viewer_joined live_stream.viewer_left
```

Signature `raven-signature: t=<unix>,v1=<hmac-sha256 of "t.rawBody">`,
plus `raven-event-id` / `raven-event-type`. Tolerance 300 s. Retries
6 attempts, base 10 s ×2^(n-1), 5 s timeout, auto-disable after 50
consecutive failures. **All of these numbers match the published doc.**

### 1.5 Error vocabularies — there are five, not three

| Vocabulary | Where | Count | Source |
|---|---|---|---|
| `RAVEN_*` | HTTP error bodies | 29 | `shared/errors/error-codes.ts` |
| `RTCErrorCode` | `@ravenkash/rtc` | 13 | `packages/sdk/src/errors.ts` |
| `ChatErrorCode` | chat WS frames + `@ravenkash/chat` | 22 (server) / 26 (SDK) | `chat.constants.ts` / `chat-sdk/src/errors.ts` |
| `SignalingErrorCode` | RTC signaling WS frames | 15 | `signaling.constants.ts` |
| `EffectsErrorCode` | `@ravenkash/effects` | 5 | `packages/effects/src/errors.ts` |

Plus server-SDK-local codes (`RAVEN_TIMEOUT`, `RAVEN_NETWORK_ERROR`,
`RAVEN_INVALID_CONFIG`, `RAVEN_UNKNOWN_ERROR`) and
`LEGACY_ERROR_CODE` mapping for the deprecation window.

### 1.6 Data model

Prisma schema: 27 models, 22 enums. Notable: `User`, `UserToken`,
`AuthAccount`, `UserOnboarding`, `Project`, `ProjectMember`, `AuditLog`,
`ApiKey`, `Room`, `Participant`, `RtcToken`, `Connection`,
`ConnectionEvent`, `ErrorEvent`, `Conversation`, `ChatMember`, `Message`,
`Reaction`, `ReadState`, `Attachment`, `ChatConnection`,
`WebhookEndpoint`/`Event`/`Delivery`, `LiveStream`, `LiveStreamHost`,
`RtcServer`. **No recording model. No usage/billing model.**

### 1.7 Configuration

`shared/config/configuration.ts` is the authoritative env surface: 92
distinct `process.env.*` reads. `.env.example` documents 100 keys (some
belong to the SFU/coturn containers).

**10 env vars are read by the API but absent from `.env.example`:**

```
API_PUBLIC_URL          ← drives `telemetryUrl` handed to every client
RTC_SIGNALING_URL       ← drives `endpoint` handed to every client
NODE_ENV
DOCS_URL
EMAIL_DEV_PREVIEW
GITHUB_CALLBACK_URL     GOOGLE_CALLBACK_URL
OBSERVABILITY_CONNECTION_RETENTION_DAYS
OBSERVABILITY_ERROR_RETENTION_DAYS
OBSERVABILITY_RETENTION_SWEEP_INTERVAL_MS
```

The first two are the ones that matter: they are exactly what a
self-hoster gets wrong first, and neither appears in `.env.example` **or**
anywhere in the published docs.

### 1.8 Tests

| Area | Spec/test files |
|---|---|
| `apps/api` | 48 |
| `sdks/python` | 46 |
| `packages/cli` | 17 |
| `packages/sdk` | 13 |
| `packages/effects` | 8 |
| `packages/react-sdk` / `react-native-sdk` | 7 / 7 |
| `packages/server-sdk` | 6 |
| `packages/chat-sdk` | 4 |
| `apps/dashboard` | 4 |
| `apps/docs` | 2 (`nav.spec.ts`, `rank.spec.ts`) |
| `packages/client` | 2 |
| `sdks/flutter` | 5 Dart test files (no Dart toolchain in CI) |
| `apps/www` | 0 |

`apps/docs`' own tests **pass** (43 assertions), and its build asserts
nav↔content parity, so there are no orphan or dangling nav entries.

---

## 2. Documentation inventory — existing pages

### 2.1 Published product docs (`apps/docs/content/`, 79 pages)

Sidebar order comes from `src/lib/nav.ts`. Products tagged for the
context-aware sidebar: `rtc`, `chat`, `live-streaming`. **Effects is a
fourth top-level section but is not a tagged product** — it does not
appear in the product switcher.

#### Getting Started

| Path | Title | Purpose | Status | Problems | Action |
|---|---|---|---|---|---|
| `getting-started/introduction.md` | Introduction | What Raven is/isn't | **Incomplete** | "Concretely, Raven owns" lists control plane, tokens, rooms, chat, webhooks — omits **Live Streaming** and **Effects**, both shipped with 13 and 13 doc pages respectively | Rewrite the capability list to five products |
| `getting-started/architecture.md` | Architecture | Control plane vs RTC plane | Correct | Thin (71 lines) for the load it carries; no diagram of chat/live/effects planes | Expand; add the two WS planes and the SFU fleet registry |
| `getting-started/quickstart.md` | Quickstart | Project → token → call | **Incorrect (minor)** | `raven.rooms.create({name:'demo-room'})` then `client.join('demo-room')` — the token is minted for `room.id`; joining by *name* snippet was flagged during this audit and is now correct (§4.1). Still tells the reader to "register from the [dashboard](/)" — a link to the docs root, not `app.ravenstack.online` | Fix the dashboard link |
| `getting-started/installing-from-source.md` | Installing from source | Pre-publish install path | Correct | — | Keep |

#### RTC (11 pages)

| Path | Title | Status | Problems | Action |
|---|---|---|---|---|
| `rtc.md` | RTC Overview | Correct | — | Keep |
| `rtc/quickstart.md` | RTC Quickstart | Correct | The `join('demo-room')` snippet was flagged during this audit; the SDK fix in §4.1 makes it correct | Keep |
| `rtc/authentication.md` | RTC Authentication | Correct | — | Keep |
| `rtc/rooms-and-participants.md` | Rooms & Participants | Correct | — | Keep |
| `rtc/audio-and-video.md` | Audio & Video | Correct | — | Keep |
| `rtc/screen-sharing.md` | Screen Sharing | Correct | "Web and Flutter today; not yet on React Native" — verified: `enableScreenShare` exists in `Room` and `RavenRoom`; RN has no `getDisplayMedia` | Keep |
| `rtc/permissions.md` | Permissions | Correct | — | Keep |
| `rtc/background-audio.md` | Background Audio | Correct | — | Keep |
| `rtc/reconnection.md` | Reconnection & Network Quality | Correct | — | Keep |
| `rtc/diagnostics.md` | Diagnostics | **Outdated** | Claims `iceConnectionState`/`signalingState` are "honestly `undefined` today" because "the underlying media client doesn't expose either publicly". The native adapter **does** expose both (`room.ts` header: "were always `undefined` under the LiveKit adapter… The native adapter does"). Also omits `remoteIceConnectionState` and `remotePeerConnectionState`, which are now in `ConnectionDiagnostics` | Rewrite the `getDiagnostics()` section; document the two remote fields |
| `rtc/troubleshooting.md` | Troubleshooting | Correct | — | Keep |

Verified correct on this section: the whole `RoomEventMap` (17 events),
`TrackStats` field list, `ConnectionQuality` union, `getConnectionStats()`
shape, `room.switchCamera()` on Flutter only.

#### Chat (16 pages)

| Path | Title | Status | Problems | Action |
|---|---|---|---|---|
| `chat.md` | Chat Overview | Correct | — | Keep |
| `chat/quickstart.md` | Chat Quickstart | Correct | — | Keep |
| `chat/authentication.md` | Chat Authentication | Correct | — | Keep |
| `chat/conversations.md` | Conversations | Correct | — | Keep |
| `chat/members.md` | Members | Correct | — | Keep |
| `chat/messages.md` | Messages | Correct | — | Keep |
| `chat/message-history.md` | Message History | Correct | — | Keep |
| `chat/threads.md` | Threads | Correct | — | Keep |
| `chat/presence.md` | Presence | Correct | — | Keep |
| `chat/typing.md` | Typing Indicators | Correct | — | Keep |
| `chat/reactions.md` | Reactions | Correct | — | Keep |
| `chat/read-receipts.md` | Delivery & Read Receipts | Correct | — | Keep |
| `chat/attachments.md` | Attachments | **Needs verification** | Accurate against code, but `docs/issues/06` records that the production deployment has **no working storage driver** (Azure Blob missing, no S3 bucket). As written, a reader on the hosted deployment gets `RAVEN_NOT_CONFIGURED` | Add a deployment-availability note |
| `chat/moderation.md` | Moderation | Correct | — | Keep |
| `chat/websocket.md` | WebSocket Protocol | **Incomplete (minor)** | Token-claims example omits the `env` claim, which the gateway now signs and reads | Add `env` |
| `chat/troubleshooting.md` | Chat Troubleshooting | Correct | — | Keep |

Verified: all 14 `ChatEventMap` events, all 12 client frames, all 15
server frames, all close codes, `chat.messages.*` grouping, presence/typing
TTLs, `getReadReceipts()` 500-row cap.

#### Live Streaming (13 pages)

| Path | Title | Status | Problems | Action |
|---|---|---|---|---|
| `live-streaming.md` | Overview | Correct | Correctly states "no cloud recording… yet" | Keep |
| `live-streaming/quickstart.md` | Quickstart | Correct | — | Keep |
| `live-streaming/authentication.md` | Authentication | Correct | — | Keep |
| `live-streaming/streams.md` | Streams & Lifecycle | Correct | — | Keep |
| `live-streaming/hosts.md` | Hosts & Co-hosts | Correct | — | Keep |
| `live-streaming/viewers.md` | Viewers | Correct | — | Keep |
| `live-streaming/live-chat.md` | Live Chat | Correct | — | Keep |
| `live-streaming/reactions.md` | Reactions | Correct | — | Keep |
| `live-streaming/moderation.md` | Moderation | Correct | — | Keep |
| `live-streaming/filters.md` | Filters & Effects | Correct | — | Keep |
| `live-streaming/network-quality.md` | Network Quality | Correct | — | Keep |
| `live-streaming/analytics.md` | Analytics | Correct | Honest about what is/isn't tracked | Keep |
| `live-streaming/sdk-support.md` | SDK Support Matrix | Correct | Spot-verified: CLI has 17 test files; server SDKs do have `addHost`/`createViewerToken`; client SDKs have neither | Keep — this is the best page in the set |

**Section-level gap:** no page documents the `live_stream.*` webhooks
(see §4.4).

#### Effects (13 pages)

| Path | Title | Status | Problems | Action |
|---|---|---|---|---|
| `effects.md` … `effects/api-reference.md` (all 13) | — | **Correct** | Filter table verified field-by-field against `FILTER_DEFINITIONS`: all 9 filters, every `min`/`max`/`default` exact (`brightness -1..1/0`, `saturation 0..2/1`, `exposure -2..2/0`, `blur 0..20/6`, `beautySmooth 0..1/0.4`). Presets `vivid/warm/cool/cinematic/vintage` match. All 5 `RAVEN_EFFECT_*` codes match. `pipeline.addListener()` in the Flutter page is valid (`RavenEffectsPipeline extends ChangeNotifier`) | Keep as-is; only structural change is promoting Effects to a tagged product |

#### SDKs (6 pages)

| Path | Title | Status | Problems | Action |
|---|---|---|---|---|
| `sdk/web.md` | TypeScript / Web | Correct | — | Keep |
| `sdk/react.md` | React | **Incomplete** | Does not document `useRavenClient`, `useRavenError`, or `useChatError` — all three are exported. Correctly explains why there is no `useLiveStreamParticipants`/`useLiveStreamChat` | Add the three hooks |
| `sdk/react-native.md` | React Native | Correct | — | Keep |
| `sdk/flutter.md` | Flutter | Correct | Verified `switchCamera`, `setCameraMuted`, `setMicrophoneMuted`, `requestLayer`, `sendData`, chat `history`/`thread`/`edit`/`delete`/`addReaction` all exist | Keep |
| `sdk/node.md` | Node.js | Correct | — | Keep |
| `sdk/python.md` | Python | Correct | Verified `Raven`/`AsyncRaven` keyword-only `api_key`/`base_url`/`timeout`/`max_retries`; all 9 resources; snake_case parity | Keep |

**Missing from this section entirely:** the CLI is a separate top-level
nav item rather than an SDK row, and there is no page for
`@ravenkash/client` (the `Raven` facade + `LiveStream`) even though
`examples.md` and the live-streaming quickstart both use it.

#### Cross-cutting

| Path | Title | Status | Problems | Action |
|---|---|---|---|---|
| `authentication.md` | Authentication | Correct | — | Keep |
| `authentication/tokens.md` | Tokens | **Outdated** | "Raven's own permission vocabulary… is translated internally into the underlying SFU's grant shape. That indirection means the public API contract doesn't change if the SFU underneath ever does." The translation layer (`rtc-token-grant.mapper.ts`) **was deleted**; `rtc-token.claims.ts` says explicitly "no translation into a third party's grant shape". The paragraph describes a removed component | Rewrite the paragraph; the *conclusion* still holds, the *mechanism* doesn't |
| `webhooks.md` | Webhooks | Correct | Retries, backoff, timeout, 50-failure auto-disable, SSRF caveat, header names — all match source exactly | Keep |
| `api-reference.md` | REST API | **Incomplete** | Calls itself "the full resource map" but omits ~25 live routes (see §4.2), including the entire API-key observability surface both server SDKs call | Either complete it or restate the scope |
| `cli.md` | CLI | **Incomplete** | Omits 8 shipped commands and the whole `raven rtc` group (see §4.3) | Add the missing commands |
| `guides/build-a-video-call.md` | Tutorial | Correct | `baseUrl: 'http://localhost:4100'` verified against `DEFAULT_BASE_URL` | Keep — and note this is the *only* guide |
| `examples.md` | Examples | Correct | All 12 named example dirs exist; `LiveStream.join()` signature verified against `client/src/live/types.ts` | Add `examples/cli-workflow.md` |
| `troubleshooting.md` | Troubleshooting | Correct | 26 lines — a router page, by design | Keep |
| `production/environments.md` | Environments | **Needs verification** | Isolation claims are true at the application layer, but `docs/issues/01` (severity High) records that every environment shares one Supabase database and `rtc_servers` is a single global fleet, so a laptop SFU can be allocated a production room | Add an honest caveat, or fix the issue first |
| `production/roles-and-permissions.md` | Roles & Permissions | Correct | — | Keep |
| `production/audit-logs.md` | Audit Logs | Correct | — | Keep |
| `production/rate-limits.md` | Rate Limits | **Incomplete** | Table lists 5 routes; 16 `@RateLimit()` decorators exist (see §4.5) | Complete the table |
| `production/security.md` | Security | Correct | "Four credentials, none of which can mint another" — verified: separate secrets for JWT / RTC / chat / SFU registration, distinct `aud` claims | Keep |
| `production/observability.md` | Observability | Correct | — | Keep |
| `reference/errors.md` | Error Codes | **Incomplete** | Opens "Raven has three error vocabularies" — there are five. Omits 5 shipped `RAVEN_*` codes; omits the Effects and signaling vocabularies entirely (see §4.6) | Add the missing codes and two vocabularies |
| `reference/events.md` | Event Catalogue | **Incorrect + Incomplete** | (a) Says RTC events are available in `@ravenkash/react` "as `useRoomEvent`" — **no such export exists** anywhere in the repo. (b) Claims to catalogue "Every event Raven emits" but the webhook table has 8 of 15 rows — all 7 `live_stream.*` events are missing | Fix the hook reference; add the 7 live-stream events |

**Link hygiene:** all 73 internal `](/…)` links resolve to a real content
file. All 32 in-page anchors resolve to a real heading. No broken links
found.

### 2.2 Internal docs (`docs/`, 76 pages)

Deliberately maintained, and mostly *more current* than the published set.
It is organised partly by build phase, which leaks internal history into
reader-facing structure.

| Cluster | Files | Status | Notes / action |
|---|---|---|---|
| **Tombstones** — `sfu.md`, `signaling.md`, `signaling-protocol.md`, `media-flow.md`, `nat-traversal.md` | 5 | Correct | Exemplary: they *delete* the LiveKit-era content and point forward rather than banner-topping stale prose. Keep the pattern |
| **`rtc/*`** — README, architecture, signaling, sfu, networking, scaling, security, test-matrix | 8 | Correct | 2,500 lines, current to 2026-09-08. `rtc/signaling.md` is the only signaling-protocol reference anywhere and is **not published** |
| **`architecture/*`** — infrastructure-decisions, native-rtc-migration-map, sfu-comparison, signaling, turn, webrtc | 6 | Correct | Decision records. Correctly retains LiveKit references as history |
| **`chat/*`** — 11 files | 11 | **Duplicate** | Near-1:1 overlap with `apps/docs/content/chat/*`. Root version is *older* for most files. Two audiences (`architecture.md` is internal, the rest is product) are mixed in one directory |
| **`sdk/*` + `sdk.md`** — 8 files | 8 | **Duplicate + needs restructuring** | Overlaps `apps/docs/content/sdk/*`. `sdk/web.md` is a 84-line "Phase 11 notes" fragment that explicitly says it does not replace `sdk.md` — it should be merged into it |
| **`deployment/*`** — azure-student, dns-email, managed-postgres, production, vercel | 5 | Correct | 1,440 lines. Operator-only, correctly unpublished. `production.md` says the dashboard has "14 BFF route handlers" — **outdated, there are 25** |
| **`production/*`** — capacity-report, readiness-audit | 2 | Correct | Honest measured numbers |
| **`issues/*`** — README + 10 issues | 11 | Correct | Current to 2026-09-08. **Highest-value input to this audit** — three issues directly contradict published claims |
| **Operator singles** — local-development, development, control-plane, dashboard, turn, observability, telemetry, diagnostics, email, oauth, environments, roles, audit-logs, releases, security, security/*, cli | ~19 | Mixed | `control-plane.md` titled "(Phase 2)"; `dashboard.md`, `cli.md`, `error-codes.md` all duplicate published pages while being *more current* |
| **`error-codes.md`** | 1 | **Incomplete but ahead of published** | Missing 4 codes vs source (`NO_RTC_CAPACITY`, `RTC_SERVER_UNREACHABLE`-adjacent, `STREAM_*`); still more current than `reference/errors.md` |
| **`migration/from-livekit.md`** | 1 | Correct | Genuinely useful; **not published**, so no external reader can find it |

**Root-set gaps:** there is **no** Live Streaming and **no** Effects
documentation in `docs/` at all — 26 published pages have no internal
counterpart.

### 2.3 Other documentation artifacts

| File | Status | Problems |
|---|---|---|
| `README.md` (16 KB) | **Outdated** | (a) Its whole Documentation section links to `./docs/*.md`; it links to the published site once, in the header, and never routes a reader there by topic. (b) Status section says "Relay-only NAT traversal is untested… no test has ever forced media through coturn. This is the largest untested surface" — **fixed on 2026-09-07** (commit `c22296e`, `services/sfu/internal/room/turn_relay_test.go`, and `docs/rtc/test-matrix.md` now says "The relay path is now tested"). (c) Says "Working, end to end, and verified against a live stack: … Signaling and Raven's own SFU" while `docs/issues/09` says no browser peer connection has ever been established in production |
| `CONTRIBUTING.md`, `SECURITY.md`, `PUBLISHING.md`, `LICENSE` | Correct | — |
| `.env.example` | **Incomplete** | 10 missing keys (§1.7) |
| `services/sfu/` | **Missing** | No README in a 20-file Go service. Docker label points at `docs/rtc/sfu.md` |
| `examples/*/README.md` | Correct (spot-checked) | 12 present |
| `.docs/` (`plan.md`, `INFRASTRUCTURE_PHASES.md`) | n/a | Gitignored |
| `apps/community`, `apps/community-api` | n/a | Gitignored WIP — **do not document** |

---

## 3. Missing documentation

Things a developer would reasonably need, where **no page exists**.

### 3.1 Critical — blocks real integrations

1. **RTC signaling protocol reference.** Chat has
   `chat/websocket.md`; RTC has nothing published. `docs/rtc/signaling.md`
   (377 lines) exists but is GitHub-only. Anyone writing a non-SDK client,
   or debugging frames in devtools, has no published contract. The 15
   `SignalingErrorCode` values and the 4-digit close codes are documented
   nowhere in the product docs.
2. **Environment variable reference.** No page lists the 92 env keys.
   `API_PUBLIC_URL` and `RTC_SIGNALING_URL` determine the `endpoint` and
   `telemetryUrl` every client receives and are documented in neither
   `.env.example` nor the docs.
3. **Self-hosting / deployment guide.** `installing-from-source.md`
   covers local dev. Production deployment lives only in
   `docs/deployment/production.md` (618 lines, unpublished). No published
   answer to "how do I run this".
4. **Complete REST reference.** `api-reference.md` is a route list, not a
   reference: no request/response schemas, no per-route error tables, no
   pagination contract per endpoint. Swagger at `/docs` is generated and
   good, but it is not linked from any page except one sentence.
5. **`@ravenkash/client` SDK page.** The `Raven` facade and `LiveStream`
   class are used in `examples.md` and `live-streaming/quickstart.md` with
   no reference page behind them.

### 3.2 Significant

6. **Dashboard walkthrough.** 46 dashboard pages, zero published docs.
   The target IA's "Create a project" / "API credentials" steps have no
   page; `getting-started/quickstart.md` hand-waves with a broken link.
7. **Account & team auth flows.** Email verification, password reset,
   OAuth sign-in (GitHub/Google), onboarding — all shipped
   2026-09-08, all documented only in `docs/oauth.md` and
   `docs/email.md`, neither published.
8. **Live-stream webhooks.** 7 events exist, 0 documented.
9. **Guides.** One guide exists (`build-a-video-call`). The target IA
   asks for 8. Missing: group call, chat app, live stream, add screen
   sharing, handle reconnection, handle webhooks, production deployment.
10. **Limits & quotas page.** Ceilings are spread across
    `production/rate-limits.md` (incomplete) and prose. Nothing collects
    `maxParticipantsPerRoom: 50`, `maxFrameBytes: 65536`,
    `maxTextLength: 4000`, `maxHistoryPageSize: 100`,
    `maxRoomSubscriptionsPerConnection: 20`,
    `maxAttachmentBytes: 25 MB`, `ttlSeconds` 30–21600, chat token
    1 h/6 h.
11. **Changelog / versioning.** Changesets are configured
    (`.changeset/`, `PUBLISHING.md`, `docs/releases.md`) but no published
    changelog page. All packages sit at `0.1.0`, unpublished.
12. **FAQ.** None.
13. **Migration guide, published.** `docs/migration/from-livekit.md` is
    exactly what an evaluating team wants, and it is invisible to them.

### 3.3 Worth having

14. Telemetry & privacy — what `@ravenkash/rtc` reports and how to disable
    it (`telemetry: false`). Only in `docs/telemetry.md`.
15. Browser support matrix as its own page (currently a section of
    `rtc/troubleshooting.md`; `getBrowserSupportDetails()` is exported and
    undocumented).
16. SFU operations for self-hosters — registration secret, heartbeat,
    drain/undrain, region allocation.
17. `services/sfu/README.md`.
18. Data retention & deletion — retention sweepers exist for chat
    messages, connections, and error events; no single page says so.
19. Idempotency — `Idempotency-Key` is supported on RTC token mint (5 min)
    and chat sends; documented only in scattered prose.

---

## 4. API / SDK inconsistencies — documentation vs implementation

### 4.1 Code defect surfaced by the audit — **FIXED**

`packages/sdk/src/config.ts` decoded the token's room from
`json.video.room`, which was **LiveKit's** claim path. Raven's own signer
emits `rid` (room id) and `rnm` (room name) at the top level
(`rtc-token.claims.ts`), so the claim read back `undefined` and
`assertTokenMatchesRoom()` never fired — despite its docstring promising a
client-side bail-out. `client.join('anything')` proceeded to a connection
that then failed at the signaling gateway.

Fixed: `decodeTokenPayload()` now reads `rid`/`rnm`/`sub`/`exp`, and
`assertTokenMatchesRoom()` accepts **either** the id or the name — which is
what `RtcTokenClaims`' own comment on `rnm` always said the SDK would do
("carried next to `rid` because the SDK accepts either"). A token carrying
neither claim still passes, and the code now says why: this is a courtesy
check, not authorization — the signaling gateway re-verifies the signed room
on every join.

The test fixtures are why this stayed invisible. Every `makeToken()` call in
`packages/sdk/test/` and the RTC fixture in
`packages/client/test/raven.spec.ts` built LiveKit-shaped payloads, so the
existing `join('a-different-room') → ROOM_NOT_FOUND` assertion passed
vacuously. Fixtures now use the real claim names, plus a regression test
asserting a `video.room` claim is **ignored**, and two new cases covering
id-or-name acceptance.

Consequence for the docs: `getting-started/quickstart.md` and
`rtc/quickstart.md` are **correct as written** — they mint for `room.id` and
join by name, and the name is now genuinely accepted. No doc change needed.


Also minor: `packages/sdk/src/internal/telemetry/track-stats.ts:46`
comments `bitrateBps` as "Bytes/sec"; line 115 computes
`((currentBytes - previousBytes) * 8) / elapsedSeconds` — bits/sec. The
value is right, the comment is wrong.

### 4.2 `api-reference.md` omits ~25 live routes

Missing entirely:

| Group | Routes |
|---|---|
| Email verification / password reset | 4 |
| OAuth | 3 |
| Account | `GET|PATCH /v1/users/me` |
| Onboarding | 3 |
| **API-key observability** | `GET /v1/project`, `/v1/connections`, `/v1/connections/:id`, `/v1/errors`, `/v1/errors/:id`, `/v1/metrics`, `/v1/diagnostics` |
| RTC fleet | `GET /v1/rtc/servers`, `/metrics`, `/:name`, `POST /:name/drain|/undrain`, `POST /register`, `PUT /:name/heartbeat` |
| Dashboard | `GET /v1/projects/:id/rooms/:roomId`, `POST …/rooms/:roomId/test-token`, `GET …/chat/conversations/:id`, `/members`, `/messages` |
| Infrastructure | `GET /health`, `/health/live`, `/health/ready`, `/metrics` |

The observability block is the damaging one: both server SDKs expose
`raven.connections`, `raven.errors`, `raven.metrics`, `raven.diagnostics`,
`raven.projects`, and the SDK pages document them — but the REST routes
they call appear nowhere in the "full resource map".

### 4.3 `cli.md` omits 8 commands and one whole group

Registered in `packages/cli/src/cli.ts` but undocumented:

```
raven dev                     raven logs
raven logout                  raven version
raven sdk install             raven config list
raven errors inspect <id>
raven rtc rooms list|get <room>|close <room>
raven rtc participants list <room>
raven rtc servers list|get <server>|drain <server>
raven rtc diagnostics <room>
```

Note `raven rooms *` (documented) and `raven rtc rooms *` (undocumented)
are two different command groups. Verified correct: exit codes 0–6 match
`lib/errors.ts`; `raven chat list` is a real alias of
`raven chat conversations`.

### 4.4 Webhook events: 8 documented, 15 emitted

`reference/events.md` is missing all seven `live_stream.*` events. Also
worth calling out explicitly in the docs: `room.created`,
`participant.joined` and `participant.left` are emitted by **chat
conversation** code paths, not RTC. The page does say so in a parenthetical
for `room.created` only — the other two read as RTC events.

### 4.5 Rate limits: 5 documented, 16 enforced

| Route | Limit | Documented? |
|---|---|---|
| `POST /v1/auth/register` | 5 | ✅ |
| `POST /v1/auth/login` | 10 | ✅ |
| `POST /v1/auth/verify-email` | 10 | ❌ |
| `POST /v1/auth/verify-email/resend` | 3 | ❌ |
| `POST /v1/auth/password-reset` | 5 | ❌ |
| `POST /v1/auth/password-reset/confirm` | 5 | ❌ |
| `POST /v1/auth/oauth/:provider/start` | 20 | ❌ |
| `POST /v1/auth/oauth/:provider/exchange` | 10 | ❌ |
| `POST /v1/projects/:id/api-keys` | 20 | ✅ |
| `POST /v1/rooms/:roomId/rtc-tokens` | 60 | ✅ |
| `POST …/rooms/:roomId/test-token` | 30 | ❌ |
| `POST /v1/live-streams` | 30 | ❌ |
| `POST /v1/live-streams/:id/hosts` | 60 | ❌ |
| `POST /v1/live-streams/:id/viewer-tokens` | 120 | ❌ |
| `POST /v1/telemetry/events` | 600 | ✅ |

### 4.6 Error codes

**In source, missing from `reference/errors.md`:**
`RAVEN_NO_RTC_CAPACITY`, `RAVEN_RTC_SERVER_NOT_FOUND`,
`RAVEN_OAUTH_ERROR`, `RAVEN_OAUTH_EMAIL_UNAVAILABLE`,
`RAVEN_OAUTH_EMAIL_UNVERIFIED`.

**In `reference/errors.md`, not in the API's namespace** —
`RAVEN_INVALID_CONFIG`, `RAVEN_NETWORK_ERROR`, `RAVEN_TIMEOUT`,
`RAVEN_UNKNOWN_ERROR`. These are **correct**: they are server-SDK-local
codes and the page labels them as such. Verified in
`server-sdk/src/http-client.ts` and `errors.ts`. No action.

**Whole vocabularies absent:** `SignalingErrorCode` (15 values) and
`EffectsErrorCode` (5 values, documented only inside the Effects section).
`RTCErrorCode`'s `NOT_SUPPORTED` is missing from the SDK-code→category
mapping table.

**Documented-but-unreachable:** `TOKEN_REVOKED` /
`RavenChatAuthenticationError`. `ChatTokenService.revoke()` exists and the
gateway checks the revocation key, but **no REST endpoint, CLI command, or
SDK method can call `revoke()`**. Meanwhile
`authentication/tokens.md` says "There's no way to revoke a single
already-issued token early" — accurate for the public API, but the two
statements should be reconciled on one page.

### 4.7 React hooks

| Symbol | Docs | Source | Verdict |
|---|---|---|---|
| `useRoomEvent` | referenced in `reference/events.md` | **does not exist** | Incorrect |
| `useRavenClient` | — | exported | Missing |
| `useRavenError` | — | exported | Missing |
| `useChatError` | — | exported (`/chat` entry) | Missing |
| `useLiveStreamParticipants`, `useLiveStreamChat` | documented as *deliberately absent* | absent | Correct |

### 4.8 Stale mechanism descriptions

| Claim | Where | Reality |
|---|---|---|
| RTC permissions are "translated internally into the underlying SFU's grant shape" | `authentication/tokens.md` | Mapper deleted; one vocabulary end to end |
| `iceConnectionState`/`signalingState` "always undefined" | `rtc/diagnostics.md` | Native adapter reports both |
| Dashboard has "14 BFF route handlers" | `docs/deployment/production.md` | 25 |
| "Relay-only NAT traversal is untested… largest untested surface" | `README.md` | Tested since 2026-09-07 |

---

## 5. Broken examples

I checked every fenced code block in `apps/docs/content` against the
exported symbols of the package it imports. **The examples are in
better shape than the prose.** Confirmed problems:

| # | Example | File(s) | Problem | Severity |
|---|---|---|---|---|
| 1 | `client.join('demo-room')` after minting for `room.id` | `getting-started/quickstart.md`, `rtc/quickstart.md`, `examples.md` | **Resolved in code, not docs.** The snippets pass a room *name*; the SDK's room guard was dead (§4.1) and has been repaired to accept id *or* name, per its documented intent. The examples are correct as written | ~~High~~ → none |
| 2 | `useRoomEvent` | `reference/events.md:19` | Named export does not exist — copying it is an immediate `TypeError`/build error | **High** |
| 3 | `getDiagnostics()` comment block | `rtc/diagnostics.md:14-20` | Annotates `iceConnectionState`/`signalingState` as "currently always undefined"; omits `remoteIceConnectionState`/`remotePeerConnectionState`. The code runs, the comments mislead | Medium |
| 4 | Attachment upload flow | `chat/attachments.md` | API-correct, but returns `RAVEN_NOT_CONFIGURED` on the current hosted deployment (`docs/issues/06`) | Medium |
| 5 | Chat token claims JSON | `chat/websocket.md:38-49` | Omits the `env` claim a real token now carries | Low |
| 6 | `[dashboard](/)` | `getting-started/quickstart.md:11` | Links to the docs root, not `app.ravenstack.online` | Low |

Verified **working** (no action):

- `createRTCClient({token, endpoint, iceServers})` — matches
  `RTCClientConfig` and the `POST /v1/rooms/:id/rtc-tokens` response
  (`{id, token, endpoint, roomId, roomName, participantIdentity,
  permissions, iceServers, telemetryUrl, expiresAt, createdAt}`).
- `raven.tokens.create({room, identity, permissions, expiresIn})` →
  `{participantIdentity, permissions, ttlSeconds, metadata}` mapping.
- `createChatClient({ token })` with no `chatUrl` — derivation from the
  token issuer is real.
- `chat.messages.thread/update/delete/addReaction/removeReaction`,
  `chat.getReadReceipts()`, `chat.markAsRead()`, `chat.setPresence()`.
- `LiveStream.join({streamId, role, rtc, chat})`, `stream.react()`,
  `stream.leave()`.
- All Effects snippets, including every filter range.
- All Flutter snippets (`switchCamera`, `chat.history`, `chat.thread`,
  `pipeline.addListener`).
- All Python snippets (`Raven`/`AsyncRaven`, `room["id"]` TypedDict
  access, snake_case resources).
- `new Raven({ apiKey, baseUrl: 'http://localhost:4100' })`.
- Port `4100` throughout (matches `.env.example` and `docker-compose.yml`;
  the code's `4000` is only a fallback).
- The webhook verification snippet — byte-for-byte equivalent to
  `verifyWebhookSignature()`.
- All 12 example app directories referenced by `examples.md` exist with
  READMEs and correct `file:` workspace deps.

---

## 6. Root cause, and the one process fix

The published docs drifted because **nothing in CI checks them against the
code.** `ci.yml` runs `pnpm -r --if-present run build`, which does exercise
`apps/docs`' nav↔content assertion — so structure is guarded — but there
is no check that a snippet still compiles, that a documented route still
exists, or that a documented symbol is still exported.

Every §4 finding is mechanically detectable:

| Check | Catches |
|---|---|
| Type-check extracted TS snippets against built packages | `useRoomEvent`, any renamed export |
| Diff `api-reference.md` routes against the Swagger JSON | all 25 missing routes |
| Diff error-code tables against `error-codes.ts` / `errors.ts` | all 5+5+15 gaps |
| Diff `reference/events.md` against `WEBHOOK_EVENT_TYPES` + `RoomEventMap` + `ChatEventMap` | 7 missing live-stream events |
| Diff CLI doc against `buildCli()`'s registered commands | 8 missing commands |
| Diff `.env.example` against `process.env` reads | 10 missing keys |

Adding these matters more than any single rewrite below.

---

## 7. Proposed target information architecture

Adapted from the requested starting point to match what Raven actually
ships. Changes from the proposal, each with a reason:

- **Effects is promoted to a top-level product** (13 pages, own package,
  own error vocabulary, own React hook). Omitting it would hide a
  shipped product.
- **"Live Streaming → Recording" is dropped.** No recording exists
  anywhere in the codebase, and the docs currently say so honestly.
- **"Chat → Channels" becomes "Conversations."** The API resource is
  `/v1/chat/conversations`; `ConversationType` is
  `ROOM | CHANNEL | DIRECT`. "Channels" is one of three types, not the
  primitive.
- **"RTC → Rooms/Participants/Audio/Video/Tracks" collapses to four
  pages.** The existing split already matches the SDK surface; five
  thinner pages would fragment `Room`'s API across files.
- **A "Self-hosting" section is added.** Raven is open source with a
  Docker Compose stack, a Go SFU, coturn, and 92 env vars; the proposed
  IA had nowhere to put any of it.
- **"Signaling Protocol" is added under RTC**, publishing
  `docs/rtc/signaling.md` — the largest single content gap.

```
Introduction
  What is Raven?                    ← rewrite: five products, not three
  Architecture                      ← expand: control plane, RTC plane,
                                       chat plane, effects (client-side),
                                       SFU fleet registry
  Core concepts                     ← NEW: project, environment, key,
                                       token, room, conversation, stream,
                                       participant, track
  Quickstart

Get Started
  Create a project                  ← NEW (dashboard walkthrough)
  API credentials                   ← NEW (keys, environments, rotation)
  Install an SDK                    ← from installing-from-source
  Authentication                    ← existing authentication.md
  Your first call                   ← from rtc/quickstart
  Your first conversation           ← from chat/quickstart

RTC
  Overview · Quickstart · Authentication
  Rooms & Participants · Audio & Video · Screen Sharing
  Tracks & Publishing               ← NEW (split out; publish/unpublish,
                                       mute vs unpublish, simulcast layers,
                                       subscription.update)
  Permissions · Background Audio
  Reconnection & Network Quality · Diagnostics
  Events                            ← NEW (RoomEventMap, split from
                                       reference/events.md)
  Signaling Protocol                ← NEW (publish docs/rtc/signaling.md)
  Troubleshooting

Chat
  Overview · Quickstart · Authentication
  Conversations · Members
  Messages · Message History · Threads
  Presence · Typing · Reactions · Read Receipts
  Attachments · Moderation
  Events                            ← NEW (ChatEventMap)
  Webhooks                          ← NEW (chat-specific event payloads)
  WebSocket Protocol · Troubleshooting

Live Streaming
  Overview · Quickstart · Authentication
  Streams & Lifecycle · Hosts & Co-hosts · Viewers
  Live Chat · Reactions · Moderation
  Filters & Effects · Network Quality · Analytics
  Stream Events                     ← NEW (7 live_stream.* webhooks)
  SDK Support Matrix
  (no Recording page — does not exist)

Effects
  Overview · Quickstart
  Filters · Presets · Pipeline
  RTC Integration · Live Streaming Integration
  React · React Native · Flutter
  Performance · Troubleshooting · API Reference

SDKs
  Web (@ravenkash/rtc, @ravenkash/chat)
  Raven Client (@ravenkash/client)    ← NEW (facade + LiveStream)
  React (@ravenkash/react)            ← + useRavenClient/useRavenError/useChatError
  React Native (@ravenkash/react-native)
  Flutter (raven_rtc / raven_chat / raven_live)
  Node.js (@ravenkash/server)
  Python (raven-sdk)
  CLI (@ravenkash/cli)                ← + the 8 missing commands
  Browser Support                    ← NEW

Backend
  Authentication · Access Tokens · Chat Tokens
  Server SDK
  Webhooks
  REST API
  Idempotency                        ← NEW
  Telemetry & Privacy                ← NEW (publish docs/telemetry.md)

Guides
  Build a video call                 ← exists
  Build a group call                 ← NEW
  Build a chat application           ← NEW
  Build a live stream                ← NEW
  Add screen sharing                 ← NEW
  Add camera effects                 ← NEW
  Handle reconnection                ← NEW
  Receive webhooks                   ← NEW
  Migrate from LiveKit               ← publish docs/migration/from-livekit.md

API Reference
  Overview & conventions             ← errors, request ids, pagination,
                                       environments
  Auth & Account API                 ← NEW
  Projects, Members & Keys API       ← NEW
  RTC API (rooms, tokens, servers)
  Chat API
  Streaming API
  Observability API                  ← NEW (the /v1/connections… block)
  Webhooks API
  Swagger / OpenAPI                  ← NEW (link /docs prominently)

Self-hosting                          ← NEW SECTION
  Overview & topology
  Docker Compose
  Environment variables              ← all 92 keys
  Database & migrations
  Running the SFU
  TURN / coturn
  Kubernetes & scaling
  Health checks & metrics
  Production checklist

Resources
  Errors                             ← all five vocabularies
  Limits & Quotas                    ← NEW
  Roles & Permissions
  Environments
  Audit Logs
  Observability
  Security
  Troubleshooting
  Examples
  Changelog                          ← NEW
  FAQ                                ← NEW
  Status & Known Limitations         ← NEW (surface docs/issues/ honestly)
```

**Also recommended, structurally:**

1. **Give the two doc sets an explicit contract.** `apps/docs/content/` =
   "how to use Raven". `docs/` = "how Raven is built and operated". Then
   move the duplicated `docs/chat/*` (11 files, product content) and
   `docs/sdk/*` (8 files) into the published set, keeping only
   `docs/chat/architecture.md` and the architecture/deployment/issues
   clusters internally. Merge `docs/sdk/web.md` into `docs/sdk.md`.
2. **Rewrite `README.md`'s Documentation section to point at the docs
   site** by topic, with `docs/` linked once as "internals". Today the
   README routes every reader away from the product docs.
3. **Drop "Phase N" from reader-facing titles** (`control-plane.md`
   "(Phase 2)", `sdk/web.md` "(Phase 11 notes)").
4. **Add `services/sfu/README.md`.**

---

## 8. Summary

### 8.1 What exists

A genuinely substantial platform, and documentation that is far better
than typical for its age. Shipped and verified in source:

- **Control plane** — NestJS, 114 REST route handlers, 27 Prisma models, JWT +
  API-key + RTC-token + chat-token auth, OAuth (GitHub/Google), email
  verification, password reset, onboarding, 5 project roles, audit log,
  environments, Redis-backed rate limiting, idempotency, Prometheus
  metrics, three-way health probes.
- **RTC** — Raven's own Go/Pion SFU with simulcast and RTCP recovery, own
  signaling protocol on `/v1/rtc`, coturn with per-token ephemeral
  credentials, fleet registry with heartbeat/drain/region allocation.
- **Chat** — durable messages, threads, reactions, read receipts,
  presence, typing, attachments, retention sweeper, own WS protocol on
  `/v1/chat/ws`.
- **Live Streaming** — host/co-host/viewer credentials, forward-only
  lifecycle, auto-attached chat conversation, reactions.
- **Effects** — 9 filters + beauty smoothing, 5 presets, WebGL/Canvas2D/
  passthrough engines, face/background/AR foundations.
- **Webhooks** — 15 events, HMAC-signed, retried, environment-scoped.
- **7 SDKs + CLI** — `@ravenkash/{rtc,chat,client,effects,react,react-native,server,cli}`,
  `raven_rtc/raven_chat/raven_live` (Dart), `raven-sdk` (Python).
- **Docs infrastructure** — a real Next.js site with product-aware
  sidebar, search index, sitemap, MDX tabs, and a build-time nav↔content
  assertion. 79 published pages, 76 internal pages, 12 runnable examples.
- Zero broken internal links; zero broken anchors; docs tests pass.

### 8.2 What is broken

| # | Issue | Impact |
|---|---|---|
| 1 | **The published docs stopped moving on 2026-08-24**; code and internal docs ran to 2026-09-08 | Root cause of everything below |
| 2 | `useRoomEvent` documented, does not exist | Copy-paste fails |
| 3 | ~~`assertTokenMatchesRoom` read LiveKit's `video.room` claim, so the documented client-side room guard never fired~~ | **Fixed** — now reads `rid`/`rnm` and accepts either; regression test added |
| 4 | `rtc/diagnostics.md` describes the removed LiveKit adapter's behaviour | Actively misleads |
| 5 | `authentication/tokens.md` describes a deleted grant mapper | Actively misleads |
| 6 | `api-reference.md` calls itself "full" while omitting ~25 routes, incl. the observability block both server SDKs call | Reader can't find the API behind a documented SDK method |
| 7 | `reference/events.md` claims "every event" with 8 of 15 webhooks | Live-stream integrations are undocumented |
| 8 | `cli.md` omits 8 commands and the whole `raven rtc` group | Feature invisibility |
| 9 | `production/rate-limits.md` lists 5 of 16 limits | Surprise 429s |
| 10 | `reference/errors.md` says "three vocabularies" (five exist), omits 5 `RAVEN_*` codes | Incomplete error handling |
| 11 | `README.md` is stale on relay testing and routes readers away from the docs site | First impression is wrong |
| 12 | 10 env vars — incl. `API_PUBLIC_URL`, `RTC_SIGNALING_URL` — undocumented everywhere | Self-hosting fails confusingly |
| 13 | `production/environments.md` and `chat/attachments.md` are contradicted by `docs/issues/01` and `/06` on the live deployment | Documented behaviour ≠ deployed behaviour |
| 14 | Nothing in CI validates docs against code | Guarantees recurrence |

### 8.3 What is missing

**Critical:** RTC signaling protocol reference (exists internally, not
published) · environment variable reference · self-hosting/deployment
guide · a real REST reference with schemas · `@ravenkash/client` page.

**Significant:** dashboard walkthrough · account/team auth flows (email
verification, password reset, OAuth, onboarding) · live-stream webhooks ·
7 of 8 requested guides · limits & quotas · changelog · FAQ · published
LiveKit migration guide.

**Worth having:** telemetry & privacy · browser support matrix · SFU
operations · `services/sfu/README.md` · data retention · idempotency ·
an honest "known limitations" page derived from `docs/issues/`.

### 8.4 What should be rewritten

In priority order.

**Tier 1 — factually wrong, small diffs**
1. `reference/events.md` — remove `useRoomEvent`; add 7 `live_stream.*` events.
2. `rtc/diagnostics.md` — rewrite the `getDiagnostics()` section.
3. `authentication/tokens.md` — replace the grant-mapper paragraph.
4. `README.md` — fix the relay-testing claim; repoint the Documentation section.
5. `getting-started/quickstart.md` — fix the `[dashboard](/)` link. (The `join()` snippets needed no edit once §4.1 was fixed.)

**Tier 2 — incomplete on shipped surface**
6. `api-reference.md` — full route map, or an honest scope statement + Swagger link.
7. `cli.md` — the 8 commands and the `rtc` group.
8. `production/rate-limits.md` — all 16 limits.
9. `reference/errors.md` — 5 codes, 2 vocabularies, `NOT_SUPPORTED`, reconcile `TOKEN_REVOKED`.
10. `getting-started/introduction.md` — five products.
11. `sdk/react.md` — the 3 undocumented hooks.
12. `.env.example` — the 10 missing keys.

**Tier 3 — structural**
13. De-duplicate `docs/chat/*` (11) and `docs/sdk/*` (8) against the published set; merge `docs/sdk/web.md` into `docs/sdk.md`.
14. Publish `docs/rtc/signaling.md`, `docs/migration/from-livekit.md`, `docs/telemetry.md`.
15. Build the Self-hosting section from `docs/deployment/*` and `docs/local-development.md`.
16. Add the CI doc-drift checks from §6.
17. Add deployment-reality caveats to `production/environments.md` and `chat/attachments.md`, or fix `docs/issues/01` and `/06` first.

### 8.5 Open questions — need a decision, not a guess

1. ~~**Is `assertTokenMatchesRoom` meant to work?**~~ **Answered, and
   fixed** — repaired to read `rid`/`rnm` and accept either, per the claim's
   own documented intent. §4.1.
2. **Should chat token revocation be exposed?** The service method and
   gateway check exist; nothing can call them. Expose it, or drop
   `TOKEN_REVOKED` from the docs.
3. **Should dashboard-internal routes appear in the public REST
   reference?** They are real, JWT-guarded, and the CLI uses several. If
   not, `api-reference.md` must stop calling itself the full map.
4. **Is Effects a product or an RTC feature?** It has its own package,
   error vocabulary, 13 pages, and three platform integrations — but it is
   not in the product switcher.
5. **Do the docs acknowledge `docs/issues/`?** The repo is admirably
   honest internally (`README.md`'s "Not built, or built but unverified"
   section, `docs/issues/09` on unverified browser RTC). The published
   docs carry none of it. Recommendation: a "Known Limitations" page —
   consistent with the honesty already established everywhere else.
