# Raven Production Readiness Audit

Step 1 of the production programme: a survey of everything built through
Phase 13, measured against the production platform requirements. No code
was changed to produce this report.

Audit date: 2026-08-18. Commit: `1ea19d0`.

> **Historical.** A point-in-time survey, kept as one. It predates the
> migration to Raven's own SFU, so anything it says about the media plane
> describes LiveKit. Current state:
> [`docs/rtc/`](../rtc/README.md) and
> [`docs/rtc/test-matrix.md`](../rtc/test-matrix.md).

---

## Summary

Raven has more working functionality than its CI or lint configuration
would suggest. **748 tests pass locally across eight test suites**, the
API builds, the dashboard typechecks, and RTC and Chat both work end to
end against live infrastructure.

The gap to production is not mostly missing features. It is three things:

1. **The quality gates do not run at all.** CI has been red on every
   workflow, and `pnpm lint` fails in every package. Neither is a
   symptom of bad code — both die before reaching any code.
2. **The platform primitives assumed by the target architecture do not
   exist yet**: environments, project members and roles, audit logs, a
   request ID, and a canonical error namespace.
3. **Diagnostics stop short of the numbers developers actually debug
   with.** `getDiagnostics()` reports connection state but no RTT,
   jitter, packet loss, bitrate, or codec.

Everything else is incremental.

---

## Verified baseline

| Suite | Tests | Result |
| --- | ---: | --- |
| `apps/api` | 244 | pass |
| `@corvidhq/rtc` | 102 | pass |
| `@corvidhq/cli` | 91 | pass |
| `@corvidhq/chat` | 67 | pass |
| `@corvidhq/react` | 42 | pass |
| `apps/dashboard` | 59 | pass |
| `raven-sdk` (Python) | 59 | pass |
| `@corvidhq/react-native` | 50 | pass |
| `@corvidhq/server` | 34 | pass |
| **Total** | **748** | **pass** |

Build: `apps/api` builds clean. Dashboard `tsc --noEmit` clean.
Infrastructure: Postgres, Redis, LiveKit, coturn, MinIO all healthy.

Not verifiable on this machine: Flutter (`raven_rtc`, `raven_chat`) — no
Dart or Flutter toolchain installed, so `flutter analyze` and the three
Dart test files have never been executed here. Treat Flutter as
**unverified**, not as passing.

---

## BROKEN — fix before anything else

> **Status: resolved in Step 0.** Each item below records what was found
> and how it was fixed. Kept rather than deleted, because the causes
> explain why so much else went unnoticed.
>
> All four workflows are now green: CI (lint, typecheck, unit tests,
> build), E2E, and Docker Publish all pass; CodeQL skips deliberately.
> Turning the gates on immediately exposed two further defects that no
> amount of reading would have found — see B4 and B5.

### B1. CI has never run a single check

All four workflows fail. Root cause is identical in every job and is the
**first step**, before lint, typecheck, test, or build:

```
$ prisma generate
Failed to load config file ".../apps/api" as a TypeScript/JavaScript module.
Error: PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL.
```

`apps/api/prisma.config.ts` resolves `env('DATABASE_URL')` eagerly, and
CI has no `.env`. `prisma generate` does not need a reachable database —
only the schema — so this is a config problem, not a missing service.

The consequence is larger than a red badge: **no push has ever been
gated.** Every defect below reached `main` because nothing checked it.
This is why B2 went unnoticed.

Severity: **critical.** Everything else in this report is unenforceable
until CI runs.

**Fixed** by setting a deliberately unreachable `DATABASE_URL` at the
workflow level in `ci.yml` — generating a client never opens a
connection, and an unreachable value means any step that *does* try to
connect fails loudly instead of writing somewhere real. `e2e.yml` needed
the opposite treatment: its `prisma:generate` step now runs *after*
`cp .env.example .env`, because injecting a placeholder there would have
shadowed the real database URL for the migrate and test steps that
follow.

Two further workflow defects surfaced while verifying this:

- **`docker-publish.yml` pinned `aquasecurity/trivy-action@0.28.0`,
  a tag that was never published.** Every run died at action resolution.
  Now `v0.36.0`.
- **`security-events: write` on a private repository without Advanced
  Security yields a token that cannot read the repository**, so both
  CodeQL and Docker Publish failed at *checkout* with "Repository not
  found". CodeQL is now gated on the repository being public, and the
  Docker workflow keeps its CRITICAL-vulnerability gate while writing
  Trivy results to a build artifact instead of code scanning. See
  "Open decisions" at the end of this document.

### B2. Lint does not exist anywhere except the dashboard

There is exactly one ESLint config in the repository:
`apps/dashboard/eslint.config.mjs`. Yet:

- `apps/api`, `@corvidhq/rtc`, `@corvidhq/chat`, `@corvidhq/react`,
  `@corvidhq/react-native`, `@corvidhq/server`, `@corvidhq/cli` all declare a
  `lint` script.
- Every one of them exits **code 2** — "no configuration file found".
- `apps/api` declares `eslint` in its `lint` script but does not have
  ESLint as a dependency at all.

CI runs `pnpm -r --if-present run lint`, so this would have failed the
Lint job even if B1 were fixed. The Definition of Done requires "lint
passes"; today lint cannot pass because it cannot start.

**Fixed** with a single root `eslint.config.mjs` (ESLint 9 flat config +
typescript-eslint) covering `apps/api` and every package, one ESLint
installation at the workspace root instead of five unusable copies, and
`--max-warnings=0` so warnings cannot quietly accumulate. `apps/dashboard`
keeps its own config, because Next.js rules genuinely differ.

The first run found **16 problems across the entire monorepo** — the code
was clean; nothing had ever been checked. All 16 were fixed rather than
suppressed:

| Finding | Resolution |
| --- | --- |
| `react-hooks/exhaustive-deps` referenced by disable comments but never installed | Added `eslint-plugin-react-hooks`; the rules now actually run on `@corvidhq/react` |
| Two `no-var-requires` disables in `@corvidhq/react-native` | typescript-eslint v8 renamed the rule to `no-require-imports`, so both directives had silently stopped covering the `require()` beneath them |
| Three unused type imports in `livekit-adapter.ts` | Removed |
| Unused `printField` import in `cli rooms inspect` | Removed |
| Stale `no-await-in-loop` disable in the e2e suite | Replaced with prose explaining why the loop is deliberately sequential |
| `require()` in test files | Allowed in tests only — it is how jest mocking works — and still forbidden in production code |

### B3. `@corvidhq/rtc` fails typecheck

```
test/livekit-adapter.spec.ts(67,26): error TS2352: Conversion of type 'A'
to type 'never[]' may be a mistake ...
```

Test-file only, so `tsup` still builds the package — but `tsc --noEmit`
fails, which is what CI's Typecheck job runs. Every other package
typechecks clean.

**Fixed** with a two-step cast through `unknown`, which is the documented
way to express a deliberate widening.

A fourth defect surfaced here: **`apps/api` had no `typecheck` script at
all**, so CI's `--if-present` typecheck job skipped the largest codebase
in the repository entirely. Adding one exposed TS6059 — `tsconfig.json`
sets `rootDir: ./src` for the build's output layout, so every file
outside `src/` (tests, `prisma/seed.ts`, `prisma.config.ts`) was an
error. A dedicated `tsconfig.typecheck.json` now covers all 188 files
without disturbing the build config.

### B4. Typecheck and tests depended on build artifacts that CI never built

Surfaced the moment CI got past `prisma generate`.

`@corvidhq/react`, `@corvidhq/react-native` and the CLI resolve their sibling
packages through `dist/` via the package `exports` map. A fresh checkout
has no `dist/`, so both the Typecheck and Unit test jobs failed with
`Cannot find module '@corvidhq/rtc'` — a build-ordering problem wearing a
missing-dependency costume.

This had always passed locally **because stale `dist/` output was lying
around**. Deleting every `dist/` reproduces CI exactly: 36 typecheck
errors and two failed React Native suites. Worth stating plainly, since
it means the earlier "748 tests pass locally" was true but for a reason
that would not survive a clean clone.

**Fixed** by building the libraries before typechecking and testing.

### B5. The container image shipped a CRITICAL vulnerability

With the Docker workflow finally reaching its scan step, Trivy failed
the build on **CVE-2026-59873**: `node-tar` below 7.5.19 enforces no
upper bound on decompressed size, entry count, or compression ratio, so
a small crafted gzip bomb can exhaust disk and CPU.

The vulnerable copy was **npm's own bundled `node-tar`** inside
`node:22-alpine` — not a Raven dependency, and not fixable from the
lockfile.

**Fixed** by removing npm in the layer that uses it. It exists in the
image solely to install pnpm, and the runtime needs only pnpm and node.
Verified in the built image: npm absent, `node`/`pnpm`/`prisma` all
working, and pnpm's own bundled tar is 7.5.22 — already past the fix.

That the gate caught a real vulnerability on its first genuine run is
the clearest evidence that turning the gates on was worth doing first.

---

## ALREADY COMPLETE — preserve as-is

These are working and tested. Do not re-architect them.

**RTC control plane and SDK.** `createRTCClient()`, `client.join()`,
`room.enableCamera()` / `enableMicrophone()` / `enableScreenShare()`,
device selection for camera/mic/speaker, publish/unpublish, reconnect
with backoff, telemetry. 102 tests.

**Chat.** The full stack: 10 Prisma models, a raw-WebSocket gateway with
demand-driven Redis pub/sub fan-out, keyset pagination over opaque
cursors, idempotency via `(conversationId, senderId, clientMessageId)`,
expiry-driven presence, typing, reactions, threads, read state, and
presigned attachment upload. 67 SDK tests plus API coverage.

**Authentication and tokens.** JWT for dashboard/CLI users, API keys
(hashed, public-id lookup) for servers, short-lived RTC tokens, separate
short-lived chat tokens with an `aud` claim and revocation support. The
client/server actor split is enforced at a single chokepoint
(`resolveSubjectId`) that ignores client-supplied identity outright.

**Webhooks.** Endpoint CRUD, HMAC-SHA256 signing (`t=…,v1=…` over
`"<t>.<rawBody>"`), a Redis-locked delivery worker, exponential backoff
with jitter, delivery logs, enable/disable.

**Observability primitives.** `Connection`, `ConnectionEvent`, and
`ErrorEvent` models; an error classifier; metrics, diagnostics, and
retention services; a telemetry ingest endpoint.

**SDK ecosystem breadth.** Eight shipping surfaces — TypeScript RTC,
TypeScript Chat, React, React Native, Flutter, Python, server
TypeScript, CLI. React Native and Flutter reuse the *same* `@corvidhq/rtc`
and `@corvidhq/chat` logic rather than reimplementing it.

**Dashboard.** 25 routes covering projects, API keys, rooms,
participants, connections, errors, metrics, diagnostics, chat
conversations and connections, webhooks, usage, quickstart, and SDKs.

---

## PARTIALLY COMPLETE

### P1. Diagnostics lack the numbers that matter (§9, §23)

`ConnectionDiagnostics` currently exposes:

```ts
connectionState, iceConnectionState, signalingState,
reconnectCount, sdkVersion, platform, browser
```

The requirement asks additionally for **RTT, jitter, packet loss,
bitrate, codec, connection type, audio quality, video quality**. None are
collected. `RTCPeerConnection.getStats()` is never called.

This also blocks the RTC dashboard (§23), which is specified to show
exactly these per-participant fields. The dashboard cannot display data
the SDK does not gather.

### P2. RTC media control is thinner than specified (§8)

Present: enable/disable camera+mic+screenshare, device selection,
broadcast data.

Missing: active speaker detection, audio levels, per-participant volume,
resolution / frame rate / video quality control, **targeted** data
messages (`sendData` is broadcast-only), room metadata and attributes,
participant limits.

Event map has no `activeSpeakersChanged` or `connectionQualityChanged`.

### P3. Chat is missing lifecycle and offline behaviour (§10, §11, §18)

- **Message lifecycle** (`pending → sending → sent → delivered → read →
  failed → retrying`) is not modelled. Read receipts exist; **delivery
  receipts do not**, and there is no `message.delivered` event.
- **Presence** supports `online` / `away` / `offline`. `do_not_disturb`
  is absent. Multi-device presence is not modelled.
- **Offline support** — local message cache, an outbound queue, and
  resynchronisation on reconnect — does not exist in any SDK. This is
  called out specifically for React Native (§18) and Flutter (§19).
- **Mentions** are not implemented.
- **Conversation types** are `ROOM` / `CHANNEL` / `DIRECT`. The target
  model distinguishes public from private channels; today it does not.
- **Push notifications** (§18, §19) are absent on both mobile SDKs.

### P4. Webhooks lack the operational verbs (§15)

Have: registration, signing, retries, backoff, delivery logs,
enable/disable.

Missing: endpoint **verification**, **replay**, and a **test-send**
endpoint. `raven webhooks test` in the target CLI has nothing to call.

Event catalogue is 8 types:

```
message.created  message.updated  message.deleted
reaction.added   reaction.removed
room.created     participant.joined  participant.left
```

The target catalogue (§12) adds `room.started`, `room.ended`,
`participant.updated`, `track.published`, `track.unpublished`,
`connection.state_changed`, `conversation.created`,
`conversation.updated`, `member.joined`, `member.left`,
`typing.started`, `typing.stopped`, `presence.online`,
`presence.offline`, `message.delivered`, `message.read`.

Envelopes also lack `event_id` and `environment`.

### P5. CLI is missing five command groups (§20)

Present: `login`, `logout`, `whoami`, `init`, `dev`, `version`,
`status`, `logs`, `projects`, `keys`, `rooms`, `chat`, `config`, `sdk`,
`connections`, `errors`, `diagnostics`.

Missing: `webhooks` (list/create/test), `usage`, `environments`,
`messages`, and `keys rotate` (only create/list/revoke exist).

`raven logs` is an **honest stub** — it prints "Logs are not available
for this project yet" rather than fabricating output. Correct behaviour
given no endpoint exists, and it should stay honest until §25 ships.

### P6. Python SDK is missing two resources (§17)

Has: `chat`, `connections`, `diagnostics`, `errors`, `metrics`,
`projects`, `rooms`, `tokens` — each with sync and async variants and a
test asserting the two surfaces never drift.

Missing: `users` and `webhooks`.

### P7. Dashboard is missing four sections (§21)

No environment switcher, no analytics page, no audit log view, no chat
moderation, and no members/roles management in settings.

---

## MISSING — platform primitives that do not exist

### M1. Environments (§6, §29) — RESOLVED

`Environment` (development/staging/production) now isolates API keys,
chat tokens, rooms, conversations, webhook endpoints and telemetry.
Never named by the request — an API key carries one, a chat token
inherits it as a signed claim. Cross-environment reads return 404, not
403. See docs/environments.md.

### M1-original (kept for context)

`Project` has no environment concept. There is no
development/staging/production isolation of keys, configuration,
webhooks, logs, or usage. This is load-bearing for §29 and appears in
the event envelope (§12), the dashboard (§21), and the CLI (§20).

Everything downstream depends on it, which makes it the first thing to
build after CI.

### M2. Roles, members, and RBAC (§27) — RESOLVED

`ProjectMember` with five roles (Owner/Admin/Developer/Viewer/Billing),
expressed as capabilities rather than role comparisons scattered through
controllers. Twenty-six ownership checks across seven controllers became
capability checks. §24's "apply project permissions before showing chat
data" is now implementable — chat routes require `chat:read`, which
Billing does not hold. See docs/roles.md.

### M2-original (kept for context)

`Project` has a single `ownerId`. There is no `ProjectMember`, no role
enum (`Owner`, `Admin`, `Developer`, `Viewer`, `Billing`), and no
authorization beyond "are you the owner". §24 requires project
permissions to gate access to message content in the dashboard — not
currently possible.

### M3. Audit logs (§30) — RESOLVED

Eleven administrative actions recorded append-only: actor, action,
resource, timestamp, request id, IP, user agent. No update or delete
exists anywhere in the path. See docs/audit-logs.md.

### M3-original (kept for context)

No model, no service, no endpoint, no UI. Key creation, revocation and
rotation, member and role changes, webhook changes, and settings changes
are all unrecorded.

### M4. Request IDs (§13, §14) — RESOLVED

Every response carries `x-request-id`; error bodies repeat it as
`requestId`. A well-formed inbound header is adopted so a developer can
trace one call across their logs and ours; anything else — newlines,
control characters, oversized values — is discarded rather than
sanitised, since a half-cleaned identifier lands in log lines.

### M4-original (kept for context)

No request-ID middleware exists, and no `request_id` appears in any
error response. The canonical error shape in §14 requires it, and every
support workflow depends on it.

### M5. Canonical `RAVEN_*` error namespace (§14) — RESOLVED

Implemented in `shared/errors/error-codes.ts`. Every error body now
carries `code` (canonical, `RAVEN_`-prefixed) and `legacyCode` (what it
used to emit) for one deprecation window. Six SDKs migrated: the two
server SDKs use the same namespace for their own local failures, and both
status-derived fallbacks now return the same names the API would. See
docs/error-codes.md.

### M5-original (kept for context)

Current codes are bare: `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`,
`UNAUTHORIZED`, `VALIDATION_FAILED`, `RATE_LIMITED`.

The target namespace is prefixed and more specific:
`RAVEN_AUTH_ERROR`, `RAVEN_PERMISSION_DENIED`, `RAVEN_TOKEN_EXPIRED`,
`RAVEN_ROOM_NOT_FOUND`, `RAVEN_CONNECTION_FAILED`, `RAVEN_RATE_LIMITED`,
`RAVEN_CONVERSATION_NOT_FOUND`, `RAVEN_MESSAGE_NOT_FOUND`,
`RAVEN_MESSAGE_ALREADY_EXISTS`, `RAVEN_WEBHOOK_FAILED`.

**This is the one unavoidable breaking change in the programme.** Six
SDKs map these codes today. It needs a compatibility window, not a
rename — see "Backward compatibility" below.

### M6. REST resources (§13)

Absent: `/v1/users`, `/v1/events`, `/v1/logs`, `/v1/usage`,
`/v1/analytics`. Usage exists as a dashboard page but has no dedicated
API resource.

### M7. Centralised logs (§25)

No searchable log store, no `API`/`RTC`/`CHAT`/`WEBHOOK`/`AUTH`/`SDK`/
`SYSTEM` categorisation, no filtering by request/user/room/conversation/
message/event ID.

### M8. Tracing (§26)

No OpenTelemetry, no spans, no trace propagation. Logs and metrics exist;
"where did it happen" does not.

---

## NEEDS REFACTOR

### R1. Rate limiting is IP-only (§28)

```ts
const redisKey = `ratelimit:${routeKey}:${request.ip ?? 'unknown'}`;
```

The requirement is to key on **project, user, IP, and API key**. IP-only
has two concrete failure modes already visible: every user behind one
corporate NAT shares a bucket, and the e2e suite had to be pinned to
`maxWorkers: 1` because three suites collided on a single IP-keyed
limiter. That workaround is a symptom of this design.

429 responses do carry `retryAfterSeconds`.

### R2. `services/` is an empty directory

Declared in `pnpm-workspace.yaml`, contains nothing. Either it has a
purpose in the target architecture or it should go.

### R3. Documentation drift risk

Docs are substantial — 40 files — but two examples in the target spec
describe APIs that **do not exist**:

- `client.joinRoom("room_123")` — the SDK method is `client.join()`.
- `raven.chat.getConversation(id)` returning an object with
  `.sendMessage({ text })` — no conversation object model exists; the
  chat SDK is client-level (`sendMessage`, `joinRoom`).

Per §36 ("never document APIs that do not exist") these must be resolved
deliberately: either add the API or correct the example. Adding
`joinRoom()` as an alias for `join()` is cheap and non-breaking. The
conversation object model is a real design decision, not a rename.

---

## PRODUCTION RISK REGISTER

| # | Risk | Impact | Severity |
| --- | --- | --- | --- |
| 1 | CI green-lights nothing (B1) | Every defect reaches `main` unchecked | **Critical** |
| 2 | No lint anywhere (B2) | Style and correctness rules unenforced | High |
| 3 | No environments (M1) | Test traffic and production traffic share credentials and data | **Critical** |
| 4 | No RBAC (M2) | Anyone with project access sees everything, including chat content | **Critical** |
| 5 | No audit log (M3) | Key rotation and permission changes are untraceable | High |
| 6 | IP-only rate limits (R1) | NAT users collectively throttled; per-project abuse uncapped | High |
| 7 | No request IDs (M4) | Support cannot correlate a report to a request | High |
| 8 | No RTC stats (P1) | Developers cannot debug call quality — a core value promise | High |
| 9 | No offline chat (P3) | Mobile message loss on poor connectivity | High |
| 10 | No webhook replay/test (P4) | Failed deliveries are unrecoverable | Medium |
| 11 | Flutter unverified | Two shipped packages never compiled or tested | Medium |
| 12 | Error code migration (M5) | Six SDKs depend on current codes | Medium |

---

## Backward compatibility positions

Public API contracts that must not break:

- `createRTCClient()`, `client.join()`, `room.enableCamera()`,
  `room.enableMicrophone()`, and the rest of the `Room` surface.
- `createChatClient()` and the `ChatClient` method set.
- Every `/v1/*` REST route listed in this audit.
- CLI command names and their `--json` output shapes.
- Webhook signature format `t=<unix>,v1=<hmac>`.

The error-code namespace (M5) is the only unavoidable break. Proposed
handling: emit both `code` (legacy) and a new prefixed field during a
deprecation window, have SDKs accept either, and document the migration
before removing the legacy field. No silent rename.

---

## Recommended sequence

The programme's own Step ordering is sound, with one amendment: **CI and
lint come before Step 2**, because a contract defined while nothing is
enforced is a contract that will drift immediately.

| Order | Work | Rationale |
| --- | --- | --- |
| 0 | Fix CI (B1), establish lint (B2), fix typecheck (B3) | Nothing below is enforceable without this |
| 1 | Environments, members/roles, audit log, request IDs, error namespace | Platform primitives everything else references |
| 2 | Rate limiting rework, RTC stats, event catalogue | Depends on environments and request IDs |
| 3 | Chat lifecycle, delivery receipts, offline sync | Largest SDK-side surface |
| 4 | Webhooks: verify, test, replay | Depends on event catalogue |
| 5 | CLI and Python gaps | Thin once the API exists |
| 6 | Dashboard sections | Depends on all APIs above |
| 7 | Logs, tracing | Cross-cutting; benefits from stable request IDs |
| 8 | Documentation and examples reconciliation | Last, so it documents what shipped |

Flutter verification should be scheduled wherever a machine with the
Dart toolchain is available; it is independent of the above.


---

## Open decisions for the repository owner

Two items in Step 0 were handled in the only way available without an
account change. Both are reversible and both are your call:

1. **CodeQL is skipped, not fixed.** It cannot run on a private
   repository without GitHub Advanced Security — the failure was at
   checkout, not analysis. The job now skips instead of failing
   permanently, and resumes by itself if the repository becomes public
   or Advanced Security is enabled. If you want static analysis before
   then, a third-party scanner that does not depend on code scanning
   would be the alternative.

2. **Trivy results go to a build artifact, not code scanning.** Same
   root cause. The security-meaningful part is unaffected: the build
   still fails on a CRITICAL, fixable vulnerability. Only the reporting
   destination changed.


---

## Step 1 — closed

All four platform primitives are implemented, tested, and merged to
`main` with CI green on every commit:

| Piece | Commit | apps/api tests | e2e tests |
|---|---|---:|---:|
| Error codes + request IDs | `9db247f` | 244 → 297 | 92 → 92 |
| Environments | `20e22f2` | 297 → 310 | 92 → 98 |
| Roles + RBAC | `aaa0b12` | 310 → 343 | 98 → 108 |
| Audit logs | `53dd9ba` | 343 → 356 | 108 → 116 |

Two defects were caught only by running the real app rather than by
typecheck: `apps/api` had no `typecheck` script at all until Step 0 added
one (§B4 in this document), and `WebhooksModule` was missing an import
that only NestJS's runtime dependency graph — exercised by the e2e
suite — could catch. Both are reminders that a green typecheck is
necessary, not sufficient; the e2e suite earns its cost.

Ready for Step 2: rate limiting rework (project/user/API-key keying, not
just IP), RTC connection statistics, and the expanded event catalogue —
all three now have request IDs, environments and roles to build on.
