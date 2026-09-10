# Release Readiness Audit — 2026-09-10

**Scope:** everything an external developer touches. Repository and git state, Prisma schema and production migration state, the production control plane at `api.ravenstack.online`, CORS, Chat (protocol and security), RTC signalling, RTC media, TURN/ICE, RTC token revocation, Live Streaming, the dashboard, SDK packaging and developer experience, public documentation, a from-scratch developer integration, the automated quality gates, and the gap between the working tree and what production actually runs.

**Method:** production was treated as the source of truth throughout. Nothing was marked PASS because the code existed, because a test passed, or because a commit was on a branch — every claim below was established by exercising the deployed system: live grant responses, HTTP preflights, real browser sessions driven end to end, `RTCPeerConnection.getStats()` counters, WebSocket close codes, Redis key TTLs read off the production instance, and read-only SQL against the production database. Where something could not be verified it is recorded as `NOT VERIFIED` rather than assumed.

**Headline finding:** the audit opened with nine failing areas and production running a build three commits behind `main`, and it closed with every platform capability verified working against production and **one** blocker left: `@ravenkash/rtc` on npm is still the broken `0.1.0`, so a new developer cannot install the browser SDK. The security model itself was never the problem — signed project/room/permission claims, no client-controlled authority anywhere, viewer→host escalation blocked at two independent layers, forged TURN credentials rejected. What was broken was *delivery*: correct code sitting uncommitted, correct configuration sitting in an unrun script, and a correct SDK behind a publish pipeline that could not run.

---

## 1. Outcome at a glance

| Area | Audit (start) | Now | Blocker |
|---|---|---|---|
| Repository / secrets | PASS | PASS | NO |
| Database migration | FAIL — unapplied | **PASS** — applied, verified | NO |
| Production API hostname | FAIL — Azure hostname in grants | **PASS** | NO |
| CORS | FAIL — no origin allowed | **PASS** | NO |
| Chat protocol | PASS | PASS | NO |
| Chat reachability | FAIL — every origin refused | **PASS** | NO |
| Chat security | PASS | PASS | NO |
| RTC signalling | PASS | PASS | NO |
| RTC WebSocket Origin | FAIL — not deployed | **PASS** | NO |
| RTC media | FAIL — no media at all | **PASS** — verified with RTP counters | NO |
| TURN credentials | PASS | PASS | NO |
| TURNS (TLS relay) | FAIL — cert hostname mismatch | **PASS** | NO |
| RTC token revocation | FAIL — not deployed | **PASS** — full lifecycle | NO |
| Chat token revocation | `SECURITY GAP` | `SECURITY GAP` — unchanged | NO |
| Live Streaming | PASS | PASS | NO |
| Dashboard | FAIL — nonexistent API in onboarding | **PASS** (code); authenticated surfaces `NOT VERIFIED` | NO |
| Documentation | FAIL — claimed packages unpublished | **PASS** | NO |
| Release pipeline | FAIL — could never publish | **PASS** — reaches the publish step | NO |
| Dependency security | FAIL — 14 HIGH + 1 CRITICAL | **PASS** — 0 HIGH, 0 CRITICAL | NO |
| **SDK npm install** | **FAIL** | **FAIL** — registry still serves `0.1.0` | **YES** |
| Fresh developer integration | FAIL — 5 of 14 steps blocked | Blocked only by the above | **YES** |

**Decision: 🔴 DO NOT RELEASE** — one blocker, resolvable by rotating a single credential.

---

## 2. What was wrong at the start

Two findings explained most of the rest.

**Everything was uncommitted.** 118 changed paths sat in one working tree: per-project allowed origins, per-route CORS, RTC token revocation, RTC and Chat WebSocket origin validation, typed SDK errors, and the publish gates. `origin/main` had none of it. Production was running `raven-api:0f14ad1`, two commits behind even `main`.

**Production configuration named its own infrastructure.** `API_PUBLIC_URL`, `RTC_SIGNALING_URL`, `CORS_ORIGIN` and `TURN_HOST` all pointed at Azure resource names rather than Raven's own hostnames. That single misconfiguration produced four separate symptoms: grants handed browsers `*.azurecontainerapps.io`, CORS reflected exactly one origin (the API's own Azure hostname, so no developer origin worked), Chat refused every browser because the gateway checked `Origin` against that same list, and TURNS advertised a hostname the certificate did not cover.

The media failure had two independent causes, which is why neither fix alone resolved it — established by testing them separately:

- **SFU:** answered with `a=setup:actpass`, which is illegal in an answer. Chrome rejected it with `Failed to set SSL role for the transport`, the peer connection wedged in `have-local-offer`, and a video track added after the first offer could never be advertised.
- **Browser SDK:** `negotiatePublish()` was a check-then-act race, so a publish could be silently dropped while the SDK logged `camera published`.

Measured in isolation: the SDK fix alone restored **bidirectional audio** (the second participant previously published nothing at all) but left video dead. The SFU fix was what unblocked video. Both were required.

---

## 3. Work done

Commits on `fix/sfu-dtls-answering-role`, merged to `main` via PRs #41, #43, #45, #49.

| Commit | What |
|---|---|
| `0797ed2` | SFU always takes the DTLS server role, whichever side offered |
| `d7f48ea` | Per-project allowed origins, RTC token revocation, per-route CORS, RTC/Chat WS origin validation |
| `6e02b7d` | Release pipeline `DATABASE_URL`; changesets peer-bump suppression; 14 HIGH advisories; dashboard `RavenClient`; "not published to npm" docs |
| `608878e` | Docker build context — `.next` and `sdks/` (~800 MB) were uploaded on every build |
| `eeea3db` | `browser-security.md` had no frontmatter, failing the docs build at `/search-index.json` |
| `e7f1bb8` | CRITICAL CVE-2026-56854 in the SFU's `golang.org/x/crypto` |
| `501d552`, `eb5ac4a` | Serialized negotiation, media restored across reconnects, data-channel bootstrap, `createCustomTrack` |
| `627a4d8` | Quickstart's chat client never joined a conversation |

### Findings not in the original brief

Four problems surfaced during the work that were not among the eleven listed blockers:

- **CRITICAL CVE-2026-56854** (`golang.org/x/crypto` < 0.55.0) was failing the SFU publish pipeline outright. Not reachable from Raven — the SFU imports no ssh package — but a CRITICAL in a shipped binary, and the gate that caught it is the gate that stops the image publishing at all.
- **`browser-security.md` shipped with no frontmatter**, so it had no `title`, and `rank()` threw on `record.title.toLowerCase()` while prerendering the search index. This failed the whole docs build. Notably `pnpm docs:verify` **passes** on that page — drift-checking reads content and links; only `next build` exercises the search index.
- **`@ravenkash/react` and `@ravenkash/react-native` would have published as `1.0.0`.** `rtc` took a minor bump, and changesets bumps peer-dependents *major* by default. Both peer-depend on it with `*`, which is never out of range, so the bump signalled a stability commitment neither had earned — and 1.0.0 cannot be walked back after npm's 72-hour unpublish window. Fixed with `onlyUpdatePeerDependentsWhenOutOfRange`.
- **The quickstart's chat client never joined a conversation.** Found by building a throwaway app from the published docs: chat connected, `sendMessage` resolved without error, and nothing ever arrived — not on the other client, not even the sender's own echo. Reading the code would not have caught this; the API is silent on the failure.

### Dependency remediation

14 HIGH advisories, all transitive behind parents that pin exact versions, so no parent upgrade could reach them. Overrides went in `pnpm-workspace.yaml` rather than `package.json` — **pnpm 11 no longer reads the `pnpm` field and ignores it with a warning rather than an error**, so they would have silently done nothing. Ranges are scoped by major (`js-yaml@^4`, `ws@^8`) where an older copy legitimately lives elsewhere in the graph.

```
pnpm audit --prod --audit-level high:   14 HIGH  →  0
SFU Trivy scan:                          1 CRITICAL  →  0
```

`deepmerge-ts` crosses a major inside `@prisma/config`, so `prisma generate`, `validate` and `migrate status` were verified explicitly after the change.

---

## 4. Production verification

Every row was produced against `api.ravenstack.online` after deployment.

**Deployment state:** `raven-api--0000004`, image `ravenacr.azurecr.io/raven-api:7fda609`, **116 routes** (was 114 — the two new endpoints present). SFU reports `version: 0797ed2`.

| Check | Evidence |
|---|---|
| API hostname | `endpoint: wss://api.ravenstack.online/v1/rtc`, `telemetryUrl: https://api.ravenstack.online` — zero `azurecontainerapps.io` in RTC or Chat grants |
| CORS — control plane | Reflects all four livqeno + ravenstack origins; **silent** for `evil.example`, `localhost.evil.example`, `app.example.com.evil.example` |
| CORS — SDK surfaces | `/v1/telemetry` reflects `localhost:3000`, `:5173`, `:8080`, and an arbitrary customer origin |
| RTC WS Origin | 5/5 malformed origins → `ORIGIN_NOT_ALLOWED`, close 4001. Pre-deploy, `evil.example` connected freely with a valid token |
| Chat WS Origin | Connects from `localhost:3000` (was `4403 ORIGIN_NOT_ALLOWED`) |
| Chat E2E | 11/11 — connect, join, send, receive, ack, typing, presence, history, disconnect, reconnect |
| RTC media | Alice ↔ Bob: video **23 frames decoded** in / **81 encoded** out; live `<video>` 320×240 at `currentTime` 22s; `sig: stable`; `a=setup:passive` |
| Revocation lifecycle | connect → revoke (200) → `TOKEN_REVOKED` 4001 → idempotent 200 → wrong room 404 → unauthenticated 401 |
| Redis tombstone | Exactly 1 key, `ttl=559s` bounded by the token's remaining life, no accumulation |
| Token expiry | `TOKEN_EXPIRED` after a 30 s TTL elapsed |
| Tampered token | `INVALID_TOKEN` |
| Room isolation | `UNAUTHORIZED — roomId does not match the room authorized by this RTC token` |
| Project isolation | Foreign room id → 404, no existence oracle |
| TURNS | **1 relay candidate, zero errors** (was 0 + `Failed to establish connection`) |
| TURN | 3 relay candidates; forged credential and forged username both → `401 Unauthorized` |
| Database | Both columns present with correct defaults, 4 projects intact, `Database schema is up to date!` |

### Chat and Live Streaming security

Unchanged from the initial audit and still correct. Every escalation attempt refused: cross-conversation join and send (`PERMISSION_DENIED`), `senderId` spoofing (server uses the token's `sub`), minting a token with a browser chat token (403), tampered claims (signature rejected), bogus scopes (400), TTL beyond the cap (400). Viewer grants carry `publish: false` and a viewer sending `track.publish` is refused at the signalling layer with `PERMISSION_DENIED — publish permission required to negotiate an outgoing track`.

---

## 5. Open items

### Blocking

**`npm install @ravenkash/rtc` fails.** The registry still serves `0.1.0`, whose published manifest contains `"@ravenkash/effects": "workspace:*"` — a pnpm-internal protocol npm and yarn cannot resolve:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

The fix is merged and versioned. `main` carries `rtc@0.3.1` and `client@0.1.3` with no pending changesets. The release pipeline reaches the publish step correctly and then fails on:

```
Publishing "@ravenkash/rtc" at "0.3.1"
error ERR_PNPM_OTP_NON_INTERACTIVE
```

Authentication succeeds; npm demands a 2FA one-time password that CI cannot answer. **`NPM_TOKEN` is a Publish-type or granular token; it must be a Classic → Automation token**, which is exempt. Per-package publishing access must also read *"Require 2FA **or** an automation token"*, not *"and disallow tokens"*.

Packaging itself is proven at the release-candidate versions: `main` was built and packed in a clean worktree, and the tarballs install with npm and **no overrides**, resolving `@ravenkash/effects` from the registry.

### Non-blocking, for launch notes

- **Origin enforcement is opt-in.** Empty `allowedOrigins` means open, by deliberate migration design — every project predating the column has an empty list, and defaulting those to deny would break live applications. The deny paths are verified (malformed origins are refused even when unconfigured, which proves the service is in the request path), but *"a non-empty list rejects an unlisted well-formed origin"* is **`NOT VERIFIED`**: configuring one requires a dashboard login. A 30-second manual check.
- **`SECURITY GAP` — Chat token revocation has no endpoint.** `ChatTokenService.revoke()` exists and `verify()` checks the tombstone, but nothing exposes it. RTC has `DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}`; Chat has no equivalent anywhere. Exposure is bounded by the 1 h default / 6 h max TTL. One controller method plus a doc.
- **`/metrics` is public and unauthenticated.** Aggregate only — routes are parameterised, no tenant labels — but it leaks business volume, the internal route map, and gives an attacker a live success/failure oracle. Worth an auth token or IP allowlist before a public launch.
- **RTC tokens are replayable.** The same token opens unlimited concurrent sessions under one identity. Defensible for a bearer capability, but one leaked token means unbounded concurrent sessions billed to the project. Document the semantics.
- **`Format (prettier)` is red on `main`** — the documented ~348-file backlog awaiting a single `pnpm format` adoption commit. `Dependency review` is red because Dependency graph is disabled in repository settings. Neither is a code defect.
- **Authenticated dashboard surfaces are `NOT VERIFIED`** — project creation, API key display, settings, members, usage, onboarding. Verifying them requires signing in.

---

## 6. Operational notes worth keeping

Things that cost time here and will cost it again.

- **`az vm run-command` runs as `root`.** A `docker login` performed over SSH as `ravenadmin` writes `/home/ravenadmin/.docker/config.json`, which root never reads — the pull keeps failing with `authentication required` for no visible reason. `DOCKER_CONFIG=/home/ravenadmin/.docker` bridges it. The durable fix is a managed identity with `AcrPull`, which `06-deploy-sfu.sh` already flags as intended hardening.
- **ACR Tasks are not permitted on this subscription** (`TasksOperationsNotAllowed`), so `az acr build` is unavailable. Copying an existing image with `docker buildx imagetools create` took **278 s**; building and pushing an emulated amd64 image from an ARM machine did not finish in 25 minutes. Prefer promoting the image CI already built and scanned.
- **A stale ts-jest cache lies convincingly.** Immediately after a bulk in-place rewrite the SDK suite failed 8 tests, then 3, and the test *count* moved between 230 and 231. `jest --clearCache` restored a deterministic 231/231. If a suite looks wrong right after mass edits, clear the cache before believing it.
- **`pnpm -r run test` runs every package's jest concurrently.** Under that contention `apps/api/src/modules/auth/auth.service.spec.ts` times out at ~58 s; it passes 24/24 in isolation. Not a regression.
- **`docs:verify` is not `next build`.** Drift-checking reads content and links. Only a real build exercises the search index, which is where a missing frontmatter `title` surfaces.
- **Changesets bumps peer-dependents *major* by default**, even when the peer range is `*` and can never be out of range. Always check `changeset status` before merging a version PR.
- **The version PR will not open itself** unless *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests* is enabled. Without it the release run does all the work, force-pushes `changeset-release/main`, and fails on the final API call.

---

## 7. Remaining sequence

1. Rotate `NPM_TOKEN` to a Classic → **Automation** token; confirm per-package access allows automation tokens.
2. Re-run **Release** from the Actions tab. `main` already carries `0.3.1`/`0.1.3` with no pending changesets, so it takes the publish path directly — no new PR.
3. Confirm: `npm install @ravenkash/rtc` in a clean directory, plus one browser connect against the published package.
4. Add one production origin to a project in the dashboard and confirm an unlisted origin is refused — closes the last `NOT VERIFIED`.
5. Put `/metrics` behind auth or an IP allowlist before any public announcement.

Steps 1–3 are the release gate. Steps 4–5 are pre-launch hygiene.
