# flutter_check

Real, end-to-end checks of the Flutter SDKs (`raven_rtc`, `raven_live`)
against a real backend and a real SFU — not mocks, not unit tests. The
Flutter side runs as a genuine `flutter build web` output driven by
Playwright; there is no device/simulator with camera access in most CI
or sandboxed dev environments, and Flutter Web is the one target where
`flutter_webrtc` can run a real `getUserMedia`/`RTCPeerConnection`
against a scripted browser.

## What's here

- `live_host/` — a minimal Flutter Web app. It reads live-streaming
  credentials from a `creds` URL query parameter (the raw JSON body
  `POST /v1/live-streams/:id/hosts` or `.../viewer-tokens` returned),
  calls `RavenLiveStream.join()`, publishes camera/microphone if the
  credentials say it's a host, and mirrors every state transition to
  `window.__state` so a test driving it (Playwright, or anything else
  that can read a page's JS globals) can poll it the same way the
  existing JS-SDK harnesses at `apps/api/test/e2e-harness/` do.

The actual test that drives it lives at
`apps/api/test/flutter-live-streaming.e2e-spec.ts` — see that file's
module doc for the full picture (why Flutter Web, why a scratch
database, how media is actually validated). It:

1. Boots a real NestJS app in-process against a scratch Postgres.
2. Registers a real local SFU into that scratch database.
3. Mints real host/viewer credentials over the real REST API.
4. Serves `live_host`'s `flutter build web` output and drives it with
   Playwright (Chrome's fake camera device stands in for real
   hardware).
5. Drives a real browser viewer with the real `@ravenkash/rtc` browser
   build (`apps/api/test/e2e-harness/live-viewer.js`), and validates
   media with a raw `RTCPeerConnection.getStats()` sample taken twice,
   several seconds apart — `framesDecoded` and `bytesReceived` must
   both have strictly increased. Signaling success alone is not
   sufficient.
6. Also runs the reverse direction: a real browser host, a real Flutter
   Web viewer.

## Running it

```bash
# 1. Build the Flutter host (rebuild after touching raven_rtc/raven_live/raven_chat)
(cd flutter_check/live_host && flutter build web --release)

# 2. Start a scratch Postgres and migrate it (never point this at the
#    shared Supabase DATABASE_URL — see apps/api/test/guard-database-target.ts)
docker run --rm -d --name raven-e2e-db \
  -p 5455:5432 -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=raven \
  postgres:16-alpine
E2E_DB="postgresql://postgres:scratch@localhost:5455/raven"
(cd apps/api && DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" pnpm prisma:migrate:deploy)

# 3. Everything else in .env (Redis, the local SFU/coturn, RTC/SFU
#    secrets) must already be up — npm run infra:up / infra:verify at
#    the repo root, if it isn't already.

# 4. Run the check
(cd apps/api && DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" \
  npx jest --config ./test/jest-e2e.json flutter-live-streaming)

# 5. Tear the scratch database down — it's disposable, nothing in it matters
docker rm -f raven-e2e-db
```

## Published-package validation

`live_host/` builds against the local working tree (`path:` dependencies),
so it proves the source is correct but not that what an external developer
actually gets from `pub.dev` behaves the same way. `published_consumer/`
is the same style of harness pointed at the real, hosted package versions
(`raven_rtc`, `raven_live`, `raven_chat` as plain `^x.y.z` constraints, no
`dependency_overrides`) — see the `*-pubdev.e2e-spec.ts` suites under
`apps/api/test/`.

**raven_rtc 0.1.4 — verified 2026-09-15.** Fixes a join-time signaling
race (`SignalingClient.send()` silently dropped the client's SDP answer
when the SFU's offer beat the API's `room.joined` confirmation, so the SFU
gave up after its 15s `answerTimeout`) and, on the SFU side, an ICE mDNS
resolution gap that stranded every receive-only Chrome viewer (mDNS was
fully disabled, so the `.local` candidates Chrome sends for any
camera/microphone-unpermissioned origin were discarded outright, leaving
zero usable candidate pairs). Validated with a real Flutter Web build
against the actual `0.1.4` pub.dev archive, a real spawned SFU, real
Postgres and Redis, and a real browser viewer: **20/20** passes, each
confirmed via `RTCPeerConnection.getStats()` showing `framesDecoded` and
`bytesReceived` genuinely increasing, zero dropped SDP answers, zero
negotiation timeouts. Listing confirmed live at
https://pub.dev/packages/raven_rtc (API and package page both report
`0.1.4`).

## Known gaps

- No native iOS/Android build has been exercised this way — only
  Flutter Web. The engine under test (`raven_rtc`) is the same one a
  native build uses; the platform split lives in `flutter_webrtc`,
  below it. A native pass is not something this harness can currently
  claim.
- Flutter-host-to-Flutter-viewer (two Flutter Web instances) is not
  covered; only Flutter↔browser, in both directions.
- Chrome's fake camera device is a single shared virtual resource
  within one browser process — each `it()` in the spec launches its own
  `chromium` instance for exactly this reason. Don't reuse one browser
  instance across tests that both need the camera.
