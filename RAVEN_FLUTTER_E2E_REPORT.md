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

**Root cause:** `RavenEngine.publish()` stored the local `MediaStream` in `_published[source]` immediately but didn't notify listeners until after the full SFU offer/answer round trip finished — even though the local track was ready to render much earlier.

**Raven-owned?** Yes.

**Fix:** `_notify()` moved to immediately after the local track is stored, independent of the negotiation round trip. Shipped as `raven_rtc` **0.1.8**.

**Tests performed — round 1 (unit + engine-level live check):**
- Unit: new `engine_test.dart` test proves the local track is queryable and a change notification fires *before* `publish()` resolves.
- Live, two real clients against production: local track visible via the reactive stream before `enableCamera()` resolved, in both directions (Alice: 3ms vs 6ms; Bob: 121ms vs 124ms), and each client's `remoteLiveSources` correctly showed the other's camera/mic as live.

**This round's live check only inspected engine-level participant/track flags (`isCameraEnabled`, `remoteLiveSources`) — not whether a `RavenVideoView` widget actually renders a decoding frame. That gap matters — see below.** The original "FIXED, VERIFIED (live)" status from that check is withdrawn; it was true of what it tested, but what it tested wasn't the layer the regression report is actually about.

**Tests performed — round 2 (real `RavenVideoView` + actual `<video>` element inspection, prompted by a tester report of a new two-participant regression):**

Built a second, more rigorous check app using idiomatic `RavenVideoView(participant: p, room: room)` inside a `ListenableBuilder(listenable: room)` (`flutter_check/published_consumer/lib/main_bug4_check.dart`, not committed — throwaway) and inspected the actual DOM `<video>` elements' `readyState`/`videoWidth`/`srcObject` via Chrome DevTools Protocol against two real, independent headless Chromium clients on production, real published 0.1.8.

**Reproduced a real bug:** with Alice joining and publishing first, then Bob joining ~8s later, Alice's own local tile renders correctly throughout, but **Alice's tile for Bob's remote video never renders** — `readyState: 0`, `videoWidth: 0`, no `srcObject` on the actual `<video>` element — for the entire observation window, even though the engine layer correctly reports `remoteCameraEnabled.bob: true`. Bob (second joiner) saw both his own local tile and Alice's remote tile render correctly.

Instrumented `video_view.dart` directly (temporary debug prints, not shipped) and confirmed `_syncTrack()` *does* fire for Alice's Bob-tile with a valid, non-null track, and *does* call `_renderer.srcObject = stream` with the correct stream — the Dart-level code runs as expected. The assignment is lost somewhere between that call and the actual `<video>` element, which never receives it (`hasSrcObject: false`, `networkState: 0`/`NETWORK_EMPTY`).

**Ruled out that this is caused by the Issue 5 fix itself:** re-ran the identical test with the `engine.dart` early-`_notify()` change temporarily disabled (matching pre-0.1.8 timing) — **the bug reproduced identically.** This is not a regression introduced by this session's fix; it's a pre-existing defect that a shallow (engine-flags-only) live check didn't catch.

**Attempted fix:** hypothesized the platform view only gets mounted once a track first becomes non-null (gated by `if (track == null) return placeholder;` in `build()`), so the very first `srcObject` assignment for a newly-arriving remote track lands moments before its view is even created. Restructured `RavenVideoView` to mount the `RTCVideoView` platform view as soon as the renderer is ready — independent of whether a track exists yet — with the placeholder as an overlay instead of a structural replacement, keeping a stable key across the null→first-track transition. **This did not resolve the bug** in a retest against the same scenario. Reverted (not shipped) rather than ship an unverified change per instructions.

**Raven-owned?** Not established with confidence. The Dart-level code behaves correctly (confirmed via instrumentation); the failure is between `RTCVideoRenderer.srcObject`'s setter and the actual `<video>` element, which is `flutter_webrtc`'s web platform-view implementation — a layer below `raven_rtc`, analogous to Issue 3's ownership boundary. But unlike Issue 3, no equivalent AAR/version-pin evidence has been gathered yet to confirm it's upstream rather than a `raven_rtc`-side usage pattern that trips an upstream bug.

**Correspondence with the tester's Bug #4 report:** partial. Confirmed: "whoever joins first never sees the second person's video." **Not reproduced**, across every run in this investigation: "whoever joins second never sees their own preview" — in every test here, the second joiner's own local tile rendered correctly. This could mean two related-but-distinct issues, a difference between this test's minimal harness and the tester's actual app, or non-determinism in exactly which side of a two-party subscribe race loses — not resolved here.

**Result:** The Issue 5 *timing* fix (local track visible before negotiation completes) is real, unit-verified, and still believed correct on its own terms. A **separate, more serious, and still-unfixed bug** exists in `RavenVideoView`'s remote-track rendering, independent of that fix, confirmed via direct `<video>`-element inspection against real two-client production sessions.

**Status: Issue 5 (timing) — FIXED.** **New finding, tracked separately below as Bug: Remote video never renders for a track that arrives after the widget is built — NEEDS-INVESTIGATION**, not fixed, ownership not fully established.

---

## Bug: remote `RavenVideoView` never renders for a track that arrives after the tile is first built

**Severity:** High — this breaks the core two-participant call scenario for whichever side loses the race, which per this investigation is specifically the side that joined/published first.

**Root cause:** Not conclusively pinned. Confirmed:
- Not a `RavenEngine`/participant-bookkeeping bug — `isCameraEnabled`/`videoTrackFor()` correctly reflect a live track throughout.
- Not (solely) a `RavenVideoView` Dart-logic bug — `_syncTrack()` correctly detects the new track and calls `_renderer.srcObject = stream` with a valid, non-null `MediaStream`.
- Not caused by this session's Issue 5 `engine.dart` change — reproduces identically with that change reverted.
- Not fixed by mounting the platform view earlier/keeping its key stable across a null→first-track transition (tried, reverted).
- The failure is that the browser-level `<video>` element backing the renderer never receives the `srcObject` assignment (`hasSrcObject: false`), specifically for a **remote** track that starts null at widget-build time and arrives later via the reactive `_syncTrack()` path — as opposed to a local track doing the same (works), or a remote track already live when the widget is first built (works).

**Raven-owned?** Undetermined — most likely `flutter_webrtc`'s web platform-view implementation, but not confirmed with the same rigor as Issue 3's dependency-chain evidence.

### Update — a concrete cause found, reproduced, and fixed

A later external report (Android, two emulators) described the same class of
symptom with a mechanism this session had not identified, and that mechanism
is real, deterministic, and now covered by a failing-before/passing-after
test — `raven_rtc/test/video_view_test.dart`, which drives a real `RavenRoom`
and a real `RavenVideoView` and asserts on what reaches
`videoRendererSetSrcObject`, not on widget-tree state.

**Mechanism.** Two things had to line up:

1. `RavenRoom._emitParticipants()` calls `notifyListeners()` **synchronously**,
   before the microtask that delivers the new roster on `participantChanges`.
   `RavenVideoView` listens to the room's `ChangeNotifier`, so `_syncTrack()`
   ran while `widget.participant` was still the snapshot from *before* the
   publish — which has no track, so nothing changed.
2. The rebuild that followed carried the correct snapshot, but
   `didUpdateWidget` skipped re-resolving, because `RavenParticipant.==`
   compares **identity alone**: two snapshots of the same person are equal
   however different what they are publishing is.

So the one notification that mattered resolved against stale state, and the
one rebuild that carried fresh state was guarded out. The tile then stayed on
its placeholder until some unrelated event happened to rebuild it — which is
exactly the "fixes itself later, sometimes" behaviour reported.

**Fix (shipped in 0.2.0):** `RavenVideoView` reads the participant back from
the room by identity rather than trusting the snapshot it was handed, and
re-resolves unconditionally in `didUpdateWidget` (`_syncTrack` was already a
no-op when the track hasn't changed, so the guard bought nothing and cost
this). The adaptive-layer request had the same stale-snapshot bug and is
fixed with it. `RavenParticipant.==` is unchanged — identity equality is what
keeps a roster diff stable across a publish — but now documents the trap.

**Reproduction, both directions:** with the fix reverted, the regression test
fails with the published stream never reaching the renderer at all
(`renderedStreamIds` empty); with it applied, all three cases pass. That is
the reproduction this report's own standard asked for before shipping
anything.

**What this does *not* settle.** The failure investigated above was observed
on Web via `<video>`-element inspection, and the instrumentation at the time
reported `_syncTrack()` firing with a valid track — which does not obviously
match the mechanism above. Either that instrumentation was reading a later
notification than the one that mattered, or there is a second, Web-specific
defect underneath. **The original two-client Web reproduction has not been
re-run against the fix**, and until it is, the correct claim is "a real defect
with this symptom is found and fixed", not "the Web bug is closed".

**Status: FIXED (mechanism reproduced and regression-tested), NEEDS-RETEST**
on the original two-client Web scenario to confirm it was the whole story.

---

## Final status

**Issue 1:** FIXED, VERIFIED (live)
**Issue 2:** FIXED, VERIFIED (live)
**Issue 3:** UPSTREAM (not Raven-owned); crash did not reproduce in this session's test, but on a non-mainstream image — NEEDS-RETEST on genuine mainstream hardware
**Issue 4:** FIXED, VERIFIED (tester-confirmed on 0.1.7)
**Issue 5 (timing fix itself):** FIXED — unit-verified and live-verified at the engine-flag level; this specific claim (local track notifies before negotiation completes) held up under every test
**New: remote `RavenVideoView` never renders for a late-arriving track:** FIXED (mechanism reproduced and regression-tested in `raven_rtc/test/video_view_test.dart`), NEEDS-RETEST on the original two-client Web scenario. See the update in that section: the cause is a stale participant snapshot in `RavenVideoView`, made invisible by `RavenParticipant`'s identity-only equality, not a `flutter_webrtc` platform-view problem as suspected here. Whether it accounts for *all* of what was observed on Web is unconfirmed until that reproduction is re-run.

## Remaining blockers

- **The remote-rendering bug above** — root-caused and fixed (stale participant snapshot in `RavenVideoView`; see that section's update). The remaining work is re-running the original two-client Web reproduction against the fix, which is the only thing that will confirm no second, Web-specific defect sits underneath.
- **Issue 3 mainstream retest** — this sandbox has no non-preview Android image available (confirmed: both local AVDs are 16KB-page preview images, no `cmdline-tools` to fetch a standard one) and no physical device. This is an environment limitation, not a code blocker. Not something further engineering here resolves — needs a real device or a properly-provisioned Android SDK elsewhere.
- Issues 1, 2, and 4 are fully closed out with no known caveats.

## Recommended next action

**The published Flutter SDK is NOT yet ready to tell an external developer "two-participant calls work."** Issues 1, 2, and 4 are genuinely done — fixed and confirmed live against the real production API and the real published packages, no caveats. Issue 5's specific timing claim is also genuinely fixed. But this session's deeper verification found that the actual real-world scenario the original report cared about — two people on a call seeing each other — still fails on Web, for a different, unfixed reason than what 0.1.8 addressed. Recommend: hold off telling a developer this is production-ready for real two-person calls until the remote-rendering bug above is actually root-caused and fixed, and don't repeat the mistake this session found in itself — verify with an actual rendered `RavenVideoView` and real `<video>`-element state, not just engine-level participant flags, before calling anything about RTC video "verified" again.

For Issue 3 specifically: ask a tester to specifically try a normal (non-preview) Android device or emulator image, not the 16KB-page preview image the original report used — that's still the one open question on the Android side.

## Files changed (this live-verification pass, beyond the earlier fix commits)

- `flutter_check/published_consumer/lib/main_video.dart` — added timing instrumentation (`localCameraFirstSeenAtMs`/`enableCameraResolvedAtMs`) to the existing E2E harness, for the Issue 5 live check. Not part of the SDK.
- `flutter_check/published_consumer/android/` (new), `lib/main_android_test.dart` (new) — throwaway Android crash-repro scaffold used for the Issue 3 live check. Not part of the SDK.
- `sdks/flutter/raven_rtc/lib/src/video_view.dart` — a structural fix was attempted (mount the platform view eagerly, keep a stable key across the null→first-track transition) and tested; it did not resolve the remote-rendering bug, so it was **reverted**. Working tree matches the committed 0.1.8 source exactly — nothing shipped from this attempt.
- Two throwaway diagnostic apps (`main_bug4_check.dart` and temporary debug prints in a pub-cache copy of `video_view.dart`/`engine.dart`) were used to isolate the bug and were deleted/reverted after use — not committed, not left behind.
- Nothing in `apps/api`, `packages/server-sdk`, or the shipped `sdks/flutter/{raven_rtc,raven_chat,raven_live}` source changed in this pass beyond what was already committed before this live-verification round — only re-verified, and one investigated-but-reverted attempt.
- Nothing has been committed this round.

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

# Live retest — Issue 5 timing (still fixed): join from two clients,
# enableCamera() on both, confirm each one's OWN local tile renders
# promptly (not just the remote one).

# Live retest — the unfixed remote-rendering bug: have client A join
# and publish first, wait several seconds, then have client B join and
# publish. In a REAL browser (not just engine state), check whether
# A's tile showing B's video actually renders a live frame — inspect
# the underlying <video> element's readyState/videoWidth/srcObject, not
# just room.remoteParticipants/isCameraEnabled. Expect this to still
# fail as of this report.
```
