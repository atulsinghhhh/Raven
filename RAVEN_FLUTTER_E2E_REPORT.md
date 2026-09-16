# Raven Flutter SDK — Fix and Retest E2E Report

Scope: external-developer E2E findings against `raven_rtc`, `raven_chat`, `raven_live` as published on pub.dev. Per instructions, every issue was reproduced/inspected before any code change, root-caused to an owner, and only fixed if Raven-owned. Nothing was changed to hide an upstream problem. This report has two layers: unit-level verification (first pass), and **live verification against the deployed production API and real published packages** (second pass, this update) — a live issue is never marked verified on unit tests alone.

Status taxonomy used below: `FIXED` · `VERIFIED` · `UPSTREAM` · `NEEDS-RETEST`.

---

## 0. Live environment confirmation

- **Published packages, not path/git**: `flutter_check/published_consumer`'s `pubspec.yaml` declares `raven_rtc: ^0.1.4`, `raven_chat: ^0.1.0`, `raven_live: ^0.1.0` — version constraints only. `flutter pub get`/`upgrade` resolved all three from `~/.pub-cache/hosted/pub.dev/...`; `pubspec.lock` shows `source: hosted` for every Raven package, zero `path`/`git` sources anywhere in the file.
- **`raven_rtc` 0.1.8 confirmed live and consumed**: `pub.dev/api/packages/raven_rtc` reports `0.1.8` as latest (published during this session, independent of git — publishing and committing are separate actions and nothing here has been committed). Downloaded and diffed the actual published archive: its `CHANGELOG.md` and `lib/src/internal/engine.dart` (`_notify()` right after `_published[source] = published`) match this session's Issue 5 fix exactly. `published_consumer`'s `pubspec.lock` and `.dart_tool/package_config.json` both resolve `raven_rtc` to `0.1.8` from `pub.dev` after `flutter pub upgrade`.

---

## Issue 1 — Room `409` when two clients create the same room

**Root cause:** `RoomsService.create()` did a plain check-then-act on the unique index; two racing callers could both pass the pre-check, with the loser hitting a raw `409`.

**Raven-owned?** Yes.

**Fix:** Opt-in `getOrCreate?: boolean` on `CreateRoomDto`/`CreateConversationDto`. Default (omitted) behavior is unchanged — still a hard `409`.

**Tests performed:**
- Unit: genuinely concurrent `Promise.all` race test against a stateful fake unique index, both in `rooms.service.spec.ts` and `conversations.service.spec.ts`.
- **Live, against the deployed production API** (`api.ravenstack.online`, real project API key):
  - `POST /v1/rooms {"name":"verify-fix-room-<ts>","getOrCreate":true}` called twice → **both returned HTTP 201 with the identical room id** (`922dbe64-0ac8-4a97-b9c6-4e3e0f8e545f`).
  - `POST /v1/rooms {"name":"verify-fix-strict-<ts>"}` (no `getOrCreate`) called twice → **first 201, second 409 `RAVEN_CONFLICT`** — default behavior confirmed unchanged.
  - Test rooms closed afterward (`DELETE /v1/rooms/:id`, 204) to leave no clutter.

**Result:** 161/161 unit tests passing. Live: both scenarios behaved exactly as specified.

**Remaining limitation:** None.

**Status: FIXED, VERIFIED (live).**

---

## Issue 2 — Chat conversation returns 404 when no members are supplied

**Root cause:** `createConversation()` already supported `members` end-to-end before this work began; the 404 for a zero-member conversation is intentional (a project API key isn't a chat user, so there's no "creator" identity to auto-add). The gap was documentation, not behavior.

**Raven-owned?** The 404 itself: working as designed. The missing documentation: a real gap, now fixed.

**Fix:** Strengthened JSDoc/DTO descriptions and the `docs/sdk/server/typescript.md` example — no runtime change.

**Tests performed:**
- Unit: `authorize()` Test A (member can access) / Test B (non-member refused) / Test C (zero-member conversation exists, nobody auto-added) / server-actor bypass — 4/4 passing.
- **Live, against the deployed production API**:
  - `POST /v1/chat/conversations {"name":"verify-fix-convo-<ts>","members":[{"userId":"test-user"}]}` → 201, conversation created (`conv_dODtj3KznAaXdTygbNSuKg`).
  - Minted a chat token for `test-user` scoped to it (`POST /v1/chat/tokens`) → 201.
  - `GET .../messages` as `test-user` → **200**, empty history as expected.
  - `POST .../messages {"text":"live verification message"}` as `test-user` → **201**, message stored.
  - Minted a token for a **different, never-added** identity (`test-user-b-non-member`) and hit the same endpoint → **404 `RAVEN_CONVERSATION_NOT_FOUND` / `ROOM_NOT_FOUND`** — non-member correctly refused.

**Result:** 18/18 unit tests passing. Live: member access, history, send, and non-member refusal all behaved exactly as specified.

**Remaining limitation:** None.

**Status: FIXED, VERIFIED (live).**

---

## Issue 3 — Android crash during RTC join

**Root cause (evidence-based):** `raven_rtc` ships no native/Android code. `flutter_webrtc` (pinned to its newest release) pulls a **third-party prebuilt AAR**, `io.github.webrtc-sdk:android:150.7871.01` (Google stopped publishing official WebRTC AARs) — the native binary's internal compatibility is baked in by whoever built that AAR, entirely upstream of flutter_webrtc. `compileSdk 36` was bumped for 16KB-page support (tracked at [flutter-webrtc/flutter-webrtc#1932](https://github.com/flutter-webrtc/flutter-webrtc/issues/1932)), but no upstream issue matches the exact `jvm.cc:81` assertion.

**Raven-owned?** No.

**Environment constraint discovered this session:** **no mainstream Android image exists in this sandbox.** The only connected emulator (`sdk_gphone16k_arm64`, Android 17/API 37) and the only other configured AVD (`Pixel_10`) are both explicitly `android-37.1/google_apis_playstore_ps16k` — the *same class* of 16KB-page-size preview image as the original report, not a standard image. No `cmdline-tools`/`sdkmanager` is installed to download one. This genuinely blocks satisfying "test on a mainstream Android environment" from this machine.

**Live test performed anyway, as a data point:** Scaffolded Android platform files onto `flutter_check/published_consumer` (a throwaway diagnostic entrypoint, `lib/main_android_test.dart`, not committed), built a debug APK against the **real published `raven_rtc` 0.1.8**, installed it on the available emulator, and ran the full flow against the live production API: initialize → join → enable microphone → enable camera → publish → wait 5s → leave. Logcat, captured in full:

```
nativeloader: Load .../lib/arm64-v8a/libjingle_peerconnection_so.so using class loader ... : ok
[ANDROID_TEST] ANDROID_TEST_JOINED state=connected
[ANDROID_TEST] ANDROID_TEST_MIC_OK
[ANDROID_TEST] ANDROID_TEST_CAMERA_OK
[ANDROID_TEST] ANDROID_TEST_LEAVING
[ANDROID_TEST] ANDROID_TEST_DONE_SUCCESS
```

**No crash occurred** — no `jvm.cc`, no `Check failed`, no `SIGABRT`, no `FATAL EXCEPTION` anywhere in logcat. The native library loaded and the entire flow completed successfully, on the same class of 16KB-page preview image the original crash was reported on.

**Result:** Does not prove the bug is fixed (a non-crash on one run/device is not proof of absence, and this still isn't the "mainstream" environment requested), but is real, live, evidence that raven_rtc 0.1.8 + the current flutter_webrtc/AAR pin does **not** reliably crash on this preview-image class today. The original tester's crash may have been specific to their exact build toolchain (different AGP/Kotlin/NDK versions than this freshly-scaffolded project's current defaults) or has since been resolved by an upstream dependency update.

**Remaining limitation:** Still needs a genuine mainstream (non-preview) Android device or a standard emulator image — unavailable in this sandbox. Recommend the tester retry on their own device, or install a standard system image via Android Studio.

**Status: UPSTREAM** (ownership), **NEEDS-RETEST** (on an actual mainstream environment — this session's test used the same non-mainstream image class, just didn't reproduce the crash on it).

---

## Issue 4 — Web `facingMode` warning

**Root cause:** `_cameraConstraints` passed `facingMode: 'user'` unconditionally, including on web; `flutter_webrtc`'s web shim strips it and warns for any non-mobile user agent.

**Fix (shipped in `raven_rtc` 0.1.7, prior to this session):** `facingMode` now gated behind `!kIsWeb`.

**Tests performed:** `flutter analyze`/`flutter test` on `raven_rtc` — clean, 62/62. Confirmed the `!kIsWeb` guard intact and mobile `switchCamera()`/`enableCamera()` paths untouched.

**Result:** Tester independently confirmed fixed after upgrading to 0.1.7.

**Status: FIXED, VERIFIED** (by the external tester, on the real published package).

---

## Issue 5 — Local video remains placeholder

**Root cause (found this session, corrected from a prior "likely upstream" theory):** `RavenEngine.publish()` stored the local `MediaStream` in `_published[source]` immediately but didn't notify listeners until after the full SFU offer/answer round trip finished — even though the local track was ready to render much earlier. `RavenVideoView` and `flutter_webrtc`'s web renderer are both confirmed symmetric between local/remote (no autoplay-policy asymmetry); the bug was purely in when `raven_rtc` chose to notify.

**Raven-owned?** Yes.

**Fix:** `_notify()` moved to immediately after the local track is stored, independent of the negotiation round trip. Shipped as `raven_rtc` **0.1.8**.

**Tests performed:**
- Unit: new `engine_test.dart` test proves the local track is queryable and a change notification fires *before* `publish()` resolves. 62/62 `raven_rtc` tests passing.
- **Live, two real clients, real production API/SFU/TURN, real published 0.1.8**: launched two independent headless Chromium instances (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, matching the original tester's own methodology) against a locally-served build of `flutter_check/published_consumer`'s `main_video.dart` E2E harness, driven via raw Chrome DevTools Protocol (no extension/GUI dependency). Instrumented the harness (not the SDK) to timestamp exactly when the local track becomes visible via the reactive stream vs. when `enableCamera()` itself resolves.

  **Solo run:** `localCameraFirstSeenAtMs: 127` vs. `enableCameraResolvedAtMs: 133` — local track visible *before* `enableCamera()` resolved.

  **Concurrent two-client run** (fresh room, `alice2`/`bob2`, both publishing):
  | | localCameraFirstSeenAtMs | enableCameraResolvedAtMs | sees peer's remote camera+mic |
  |---|---|---|---|
  | Alice | 3 | 6 | ✅ `{"bob2":["camera","microphone"]}` |
  | Bob | 121 | 124 | ✅ `{"alice2":["camera","microphone"]}` |

  In both clients, in both runs, the local track became visible *before* `enableCamera()` resolved — exactly the fix's claim, confirmed live, twice, independently. Both clients reached `ready: true` with no errors, and each correctly saw the other's remote camera/microphone.

  Test rooms closed afterward; headless Chrome instances and local web server torn down.

**Not separately tested live:** camera off/on toggle — the E2E harness doesn't expose a toggle control; this remains covered by existing unit tests (`setMuted` coverage in `engine_test.dart`) only.

**Result:** Fixed, unit-verified, **and now live-verified against production with two real independent clients.**

**Status: FIXED, VERIFIED (live).**

---

## Final status

**Issue 1:** FIXED, VERIFIED (live)
**Issue 2:** FIXED, VERIFIED (live)
**Issue 3:** UPSTREAM (not Raven-owned); crash did not reproduce in this session's test, but on a non-mainstream image — NEEDS-RETEST on genuine mainstream hardware
**Issue 4:** FIXED, VERIFIED (tester-confirmed on 0.1.7)
**Issue 5:** FIXED, VERIFIED (live, two real clients against production)

## Remaining blockers

- **Issue 3 mainstream retest** — this sandbox has no non-preview Android image available (confirmed: both local AVDs are 16KB-page preview images, no `cmdline-tools` to fetch a standard one) and no physical device. This is an environment limitation, not a code blocker. Not something further engineering here resolves — needs a real device or a properly-provisioned Android SDK elsewhere.
- Everything else is closed out.

## Recommended next action

**The published Flutter SDK is ready for another external developer to test**, with one caveat to tell them up front: Issue 3 (Android) is confirmed not-Raven's-fault and didn't reproduce in this session's own attempt, but hasn't been confirmed absent on genuine mainstream hardware — ask them to specifically try a normal (non-preview) Android device or emulator image, not the 16KB-page preview image the original report used. Issues 1, 2, 4, and 5 are fixed and confirmed live against the real production API and the real published packages (`raven_rtc` 0.1.8, `raven_chat`/`raven_live` 0.1.0) — no known caveats remain on those four.

## Files changed (this live-verification pass, beyond the earlier fix commits)

- `flutter_check/published_consumer/lib/main_video.dart` — added timing instrumentation (`localCameraFirstSeenAtMs`/`enableCameraResolvedAtMs`) to the existing E2E harness, for the Issue 5 live check. Not part of the SDK.
- `flutter_check/published_consumer/android/` (new), `lib/main_android_test.dart` (new) — throwaway Android crash-repro scaffold used for the Issue 3 live check. Not part of the SDK.
- Nothing in `apps/api`, `packages/server-sdk`, or `sdks/flutter/{raven_rtc,raven_chat,raven_live}` changed in this pass — only re-verified.
- Nothing has been committed.

## Exact commands for final verification

```bash
# Backend unit tests (Issues 1 & 2)
cd apps/api && npx jest src/modules/rooms src/modules/chat

# Flutter SDK regression (Issues 4 & 5)
cd sdks/flutter/raven_rtc && flutter analyze && flutter test
cd sdks/flutter/raven_chat && flutter analyze && flutter test
cd sdks/flutter/raven_live && flutter analyze && flutter test

# Confirm published_consumer resolves Raven packages from pub.dev only
cd flutter_check/published_consumer && flutter pub upgrade && grep -A3 "^  raven_" pubspec.lock

# Live retest — Issue 1 (expect both calls to return the SAME room id)
curl -X POST "$RAVEN_API_URL/v1/rooms" -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" -d '{"name":"verify-fix-room","getOrCreate":true}'
curl -X POST "$RAVEN_API_URL/v1/rooms" -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" -d '{"name":"verify-fix-room","getOrCreate":true}'

# Live retest — Issue 2 (expect 200 for the member, 404 for a non-member)
curl -X POST "$RAVEN_API_URL/v1/chat/conversations" -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"verify-fix-convo","members":[{"userId":"test-user"}]}'

# Live retest — Issue 5: join from two clients, enableCamera() on both,
# confirm each one's OWN local tile renders promptly (not just the remote one).
```
