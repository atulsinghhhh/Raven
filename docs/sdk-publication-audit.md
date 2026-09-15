# Public SDK Publication Audit — Python & Flutter

Audit of `sdks/python` (`raven-sdk`) and `sdks/flutter/{raven_rtc,raven_chat,raven_live}`
against public PyPI/pub.dev release readiness. Livqeno's hosted control plane, dashboard,
SFU, and backend infrastructure are **not** in scope and are not touched by this
document — see [`docs/proprietary-migration-audit.md`](./proprietary-migration-audit.md)
for the platform-vs-public-SDK boundary decision this audit assumes.

No destructive changes were made while producing this document. Where a fix was safe
and unambiguous (branding language, missing metadata) it was applied directly and is
noted below; everything that requires a human decision is flagged as a blocker instead.

> **Update, same day:** the Flutter packages were published to pub.dev at `0.1.0`
> (explicit approval given). The §1 naming blocker below was resolved by renaming
> the PyPI distribution to **`livqeno-sdk`** (`livqeno`/`livqeno-sdk`/`livqeno-python`
> were all confirmed available; `livqeno-sdk` chosen). The Python import path is
> unchanged — still `from raven import Raven`. Everywhere below that says `raven-sdk`
> reflects the state at the time this audit was written; treat it as superseded by
> `livqeno-sdk` for anything not yet marked resolved. See
> `docs/public-sdk-release-checklist.md` for current status.

---

## 1. Python — `raven-sdk`

| Field | Value |
|---|---|
| Package name | `raven-sdk` |
| Path | `sdks/python/` |
| Version | `0.1.0` (`pyproject.toml`, kept in sync by hand with `src/raven/_version.py`) |
| Build backend | `setuptools>=68` + `wheel`, via `pyproject.toml` (no Poetry/Hatch/PDM/uv in use — this is the repo's existing choice, kept as-is) |
| Python support | `>=3.10`; CI matrix tests 3.10–3.13 (`.github/workflows/ci.yml`, job `python`) |
| Dependencies | `httpx>=0.28.1,<1.0` only |
| Dev tooling | `pytest`, `pytest-asyncio`, `mypy` (strict), `ruff` (format + lint), `build` |
| License | MIT (`LICENSE`, `license = {text="MIT"}`) |
| Homepage / Repo / Issues | `https://github.com/atulsinghhhh/Raven` (real, matches `git remote`) |
| Documentation URL | `https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/server/python.md` |
| Not yet on PyPI | Confirmed via `pypi.org/pypi/raven-sdk/json` |

### Package discovery / build config

`[tool.setuptools.packages.find] where = ["src"]` — standard `src/` layout, package name
`raven` (importable), distribution name `raven-sdk`. Already correct, unchanged.

### Public API surface (`src/raven/__init__.py`)

Two clients, both re-exported at the top level along with every public type:

- `Raven` — synchronous client (`client.py`)
- `AsyncRaven` — async twin, same resource shape (`async_client.py`)
- `RavenError` — single exception type for every non-2xx response and transport failure
- Resources hung off both clients: `tokens`, `rooms`, `projects`, `connections`, `errors`,
  `metrics`, `diagnostics`, `chat`, `live_streams`
- ~35 `TypedDict`/enum types covering RTC tokens, rooms, chat (conversations, messages,
  reactions, members), live streams (hosts, viewers, roles), connection/error diagnostics

This is a **server-only token-minting and management SDK** — it does not touch WebRTC,
media, or the browser. That scope is accurate and already stated prominently in the
README and module docstring ("Never import this package into browser… code").

### Metadata changes made in this audit

- Added `keywords` and PyPI `classifiers` (`Development Status :: 3 - Alpha`, Python
  3.10–3.13, `License :: OSI Approved :: MIT License`, `Typing :: Typed`, etc.) to
  `pyproject.toml` — previously absent entirely. Verified with `twine check` after
  rebuilding.
- Fixed `sdks/python/README.md`'s opening line, which called Livqeno "open-source real-time
  communication infrastructure." The rest of the repo (root `README.md`, `LICENSE`,
  `docs/proprietary-migration-audit.md`) was already repositioned to "managed real-time
  infrastructure platform" as of commit `50e0b82`; this file was missed by that pass. Now
  reads "a managed real-time infrastructure platform" and links to `https://livqeno.com`
  instead of the GitHub repo.

### Blockers

1. **`raven-sdk` is already taken on PyPI** by an unrelated project ("Async Kafka and HTTP
   producer SDK for Raven AI logs", v0.1.3, live and confirmed via PyPI's JSON API today).
   This SDK cannot be published under its current name. This is not a new finding — the
   README and `docs/releases.md` already document it — but it remains unresolved and is
   the single hard blocker to a PyPI release. **Requires a naming decision from you**; not
   something to guess at (e.g. `livqeno-sdk`, `livqeno`, a scoped/alternate name — your
   call, and it should probably match whatever the Flutter packages end up namespaced
   under, since they carry the same `raven_*` legacy naming).
2. No other blockers. Build, lint, type-check, tests, and artifact inspection all pass
   (§4 below).

### Not fabricated / left alone

Chat and live-streaming functionality are both real and implemented (`resources/chat.py`,
`resources/live_streams.py`) — the README's "Resources" line already lists them
accurately. No client-side RTC exists in this SDK (correct — it's server-only), so no
"RTC functionality" section was invented for it.

---

## 2. Flutter — `raven_rtc`, `raven_chat`, `raven_live`

| Package | Path | Version | Role |
|---|---|---|---|
| `raven_rtc` | `sdks/flutter/raven_rtc` | `0.1.0` | Join a room, publish camera/mic, render participants |
| `raven_chat` | `sdks/flutter/raven_chat` | `0.1.0` | Messaging: history, presence, typing, reactions, read receipts |
| `raven_live` | `sdks/flutter/raven_live` | `0.1.0` | Live streaming; composes `raven_rtc` + `raven_chat`, no media/messaging code of its own |

All three are valid Dart/Flutter packages already (`pubspec.yaml`, `lib/`, `test/`,
`analysis_options.yaml`, `CHANGELOG.md`, `LICENSE`, `README.md` all present and correct
shape). SDK constraints: Dart `>=3.6.0 <4.0.0`, Flutter `>=3.27.0`. CI pins Flutter
`3.47.2` (`ci.yml`); this environment has Flutter `3.47.2` / Dart `3.13.2` installed,
matching.

### Dependency graph

`raven_live` depends on `raven_rtc: ^0.1.0` and `raven_chat: ^0.1.0` as **hosted**
constraints in `dependencies`, with local `dependency_overrides` pointing at the sibling
packages for monorepo development (overrides are ignored by `pub publish`, by design —
already commented in the pubspec). This means **publish order is fixed**: `raven_rtc` and
`raven_chat` first, `raven_live` only after both are live on pub.dev, exactly as
`docs/releases.md` already states.

`raven_rtc` depends on `flutter_webrtc: ^1.6.0` (native WebRTC) and
`web_socket_channel: ^3.0.0` (signaling transport — the protocol and peer-connection
lifecycle itself is this package's own code under `lib/src/internal/`, not vendored).
`raven_chat` depends only on `web_socket_channel` and `http`. Neither declares a Flutter
plugin (no platform channels/native code of their own) — accurate per their pubspec
comments.

### Public API surface

- `raven_rtc`: `Raven` (client) → `RavenRoom` (`ChangeNotifier`, join/leave/camera/mic/
  screen-share/camera-switch), `RavenVideoView` (participant renderer), `RavenPermissions`,
  typed errors (`RavenException`, `RavenPermissionException`), and an effects pipeline
  (`RavenEffectsPipeline` — camera filters, tested but explicitly reports
  `ravenEffectsNativeEngineStatus` as "planned, not production" per its own test suite;
  documented as such, not oversold).
- `raven_chat`: `RavenChat` (`ChangeNotifier`), typed streams (`messages`, `typing`,
  `presence`, `reactions`, `readReceipts`, `connectionStateChanges`, `errors`).
- `raven_live`: `RavenLiveStream.join(credentials)`, `stream.room` / `stream.chat` are
  ordinary `RavenRoom`/`RavenChat` instances — no separate media/message API.

No internal implementation detail (SFU internals, Redis, Postgres, Azure, TURN secrets,
admin APIs) is exposed anywhere in the public `lib/` surface — confirmed by both a manual
read of the exported symbols and the keyword scan in §5.

### Metadata changes made in this audit

Fixed the same "open-source real-time communication infrastructure" line in all three
package READMEs (`raven_rtc`, `raven_chat`, `raven_live`) — identical issue to the Python
README, same root cause (missed by the `50e0b82` repositioning pass). Now reads "managed
real-time communication infrastructure" and links to `https://livqeno.com`.

### Missing metadata (non-blocking)

- No `topics:` field in any of the three `pubspec.yaml` files. pub.dev topics must come
  from Google's curated list; not adding unverified topic strings here rather than
  guessing at which ones are currently approved — worth setting once you confirm the
  current list at publish time.
- None of the three packages has its own package-level `example/` directory, which is
  what pub.dev's "Example" tab reads. A real, working, non-trivial example already exists
  at the monorepo level — `examples/flutter-rtc-chat` (§3) — that exercises `raven_rtc`
  and `raven_chat` together end-to-end (join, publish, remote video, chat panel, cleanup).
  It currently resolves both packages via local `path:` dependencies rather than pub.dev
  versions, which is correct today (they aren't published yet) and documented as such in
  its own README. Recommend, once first published, either copying a trimmed version of it
  into each package's `example/` or symlinking — not done here to avoid duplicating a
  maintained example into three stale copies.

### Blockers

None specific to Flutter. `flutter pub publish --dry-run` passes for all three packages
today (§4) — `raven_live`'s two informational hints about overridden dependencies are
expected and self-resolve once `raven_rtc`/`raven_chat` are actually on pub.dev.

---

## 3. Examples (already exist, verified accurate)

- `examples/python-server` — FastAPI server using `raven-sdk` to mint RTC and chat tokens.
  Clear server-side/client-side split, `RAVEN_API_KEY` never leaves the process,
  environment-variable driven. Already updated by the `50e0b82` repositioning commit.
- `examples/flutter-rtc-chat` — Flutter app + Node token-minting backend, demonstrates the
  full flow: init → auth (backend mints tokens) → connect → join → publish local media →
  render remote participants → chat panel with history/typing → clean leave. Uses
  `ListenableBuilder` against `RavenRoom`, which is the idiomatic pattern the Flutter
  READMEs also document.

Both were reviewed for hardcoded secrets and internal infra references — none found
(§5). Neither example needed changes for this audit.

---

## 4. Validation run (this session, all commands actually executed)

### Python (`sdks/python`, Python 3.14.7 via the repo's existing `.venv`)

| Check | Result |
|---|---|
| `ruff format --check .` | PASS — 28 files already formatted |
| `ruff check .` | PASS — all checks passed |
| `mypy src` (strict) | PASS — no issues in 19 source files |
| `pytest -q` | PASS — 75 passed |
| `python -m build` | PASS — sdist + wheel built |
| `twine check dist/*` | PASS (both artifacts) |
| Wheel contents | Only `raven/**` modules + `raven_sdk-0.1.0.dist-info/*` — no tests, no dev files, no secrets |
| sdist contents | Adds `tests/`, `pyproject.toml`, `LICENSE`, `README.md`, `setup.cfg` — standard, no stray files |
| Clean-venv install + smoke test | PASS — installed the built wheel into a fresh venv, imported `Raven`/`AsyncRaven`/`CreateTokenParams`/`RavenError`, initialized a client, listed its 9 resources, closed cleanly |

### Flutter (all three packages, Flutter 3.47.2 / Dart 3.13.2)

| Check | `raven_rtc` | `raven_chat` | `raven_live` |
|---|---|---|---|
| `flutter pub get` | PASS | PASS | PASS (resolves siblings via override) |
| `dart format --set-exit-if-changed` | PASS | PASS | PASS |
| `flutter analyze --fatal-infos` | PASS — no issues | PASS — no issues | PASS — no issues |
| `flutter test` | PASS — 32 tests | PASS — 20 tests | PASS — 8 tests |
| `flutter pub publish --dry-run` | PASS — 0 warnings | PASS — 0 warnings | PASS — 0 warnings, 2 expected hints (overridden deps) |

No emulator or device was needed — all three packages' tests are pure Dart over
`flutter_test` (matches `ci.yml`'s own reasoning for why this runs headless).

---

## 5. Security sweep (this session)

Scope: `sdks/python/` and `sdks/flutter/` tracked source, tests, and built artifacts.
Searched for `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE_KEY`, `DATABASE_URL`,
`REDIS_URL`, `TURN_SECRET`, `AZURE`, `SUPABASE`, `POSTGRES`, `CREDENTIAL`, `.env`, and
private-key/connection-string shaped literals.

**Result: no real secrets found.** Every hit classified:

- **Test fixtures with obviously-fake values** — `api_key="rvk_abc.secret"`,
  `api_key="rvk_super-secret-value.dontleakme"`, `api_key="k"` in
  `sdks/python/tests/*.py`. Fake keys used to exercise the HTTP client's auth-header
  logic; the `.dontleakme` suffix is itself a tell that these are intentionally
  non-functional.
- **Typed field/parameter names, not secrets** — `credential`, `IssuedStreamCredential`,
  `RavenLiveStreamCredentials`, `chatCredentials.token` etc. across both SDKs' public
  types. These are the shape of data the API returns (a short-lived token + ICE
  credentials), never a literal secret value.
- **Environment variable names in docs** — `RAVEN_API_KEY`, `RAVEN_API_URL` in READMEs
  and example code. Correct pattern; no literal key committed anywhere.
- **One incidental "Postgres" mention** — `raven_chat/README.md`: "Postgres is the source
  of truth" (describing chat message durability guarantees at the API level, not
  exposing connection details). Safe, public-appropriate documentation.
- **`.env`-shaped files found**: only `certifi/cacert.pem` (Mozilla's public CA bundle)
  inside `sdks/python/.venv/` — vendored, gitignored, not shipped in the built wheel/sdist
  (confirmed in §4's artifact inspection). No `.env`, credentials file, or private key
  of any kind is tracked under `sdks/`.

No AZURE, SUPABASE, TURN_SECRET, or internal-infrastructure references exist anywhere
under `sdks/`. Nothing here overlaps with or needs correction alongside
`docs/proprietary-migration-audit.md`'s repo-wide sweep (which separately found no real
secrets tracked anywhere in the monorepo).

**No STOP condition was hit.** No real credential was found in either SDK.

---

## 6. Versioning

Both SDKs are at `0.1.0` and have never been published anywhere. There is no existing
public version to preserve compatibility with, so the "next version" question is really
"what's the first version," which is a release-approval decision, not an audit finding.
Recommend publishing both at their current `0.1.0` once the PyPI naming blocker (§1) is
resolved — no reason to bump pre-first-publish. `raven_rtc`/`raven_chat`/`raven_live` and
`raven-sdk` version independently already (separate `pubspec.yaml`/`pyproject.toml`), so
this holds naturally going forward.

---

## 7. Recommended release order

1. **Resolve the PyPI name conflict for `raven-sdk`** (§1, blocker) — this is the only
   step that requires a decision before anything can move.
2. Publish `raven_rtc` to pub.dev (no dependency on anything else unpublished).
3. Publish `raven_chat` to pub.dev (independent of `raven_rtc`).
4. Publish `raven_live` (requires 2 and 3 to be live first — its hosted `^0.1.0`
   constraints on both must resolve).
5. Publish `raven-sdk` to PyPI, once named.
6. Update `PUBLISHING.md` and `docs/releases.md`'s "Python … not yet published" /
   "Dart … not yet automated" language once each package is actually live — both
   currently state accurately that nothing is published yet, and will become stale the
   moment step 2 lands.

None of this is gated on the platform/backend proprietary-positioning work in
`docs/proprietary-migration-audit.md` — that audit already concluded public SDKs are
compatible with a proprietary hosted platform (§27 of its brief) and did not flag either
SDK's *publication* as blocked, only its *branding copy* (fixed in §1/§2 above).

---

## 8. New in this audit: gated release workflows

`docs/releases.md` documented, accurately, that neither SDK has any publish automation —
`twine upload`/`flutter pub publish` are run by hand. Two new workflows were added,
mirroring this repo's existing npm OIDC trusted-publishing pattern (no long-lived tokens
stored anywhere):

- **`.github/workflows/python-release.yml`** — `workflow_dispatch` only, requires typing
  `PUBLISH` as a confirmation input, re-runs format/lint/type-check/tests/build, inspects
  the artifact contents into the job summary, then publishes via PyPI Trusted Publishing
  (`pypa/gh-action-pypi-publish`, OIDC). **Cannot succeed until §1's naming blocker is
  resolved and a trusted publisher is configured on pypi.org for whatever name is used.**
- **`.github/workflows/flutter-release.yml`** — `workflow_dispatch` only, package chosen
  from a dropdown (`raven_rtc`/`raven_chat`/`raven_live`), same `PUBLISH` confirmation,
  re-runs format/analyze/test/dry-run, then `flutter pub publish --force` via pub.dev's
  GitHub Actions OIDC automated publishing. **Requires "Automated publishing" to be
  configured per package on pub.dev** (Admin tab, once each package exists there) before
  it can succeed.

Neither workflow runs on push, and neither was invoked in this session — both were only
authored and YAML-validated (`yaml.safe_load`), not exercised end-to-end, since doing so
would require real PyPI/pub.dev trusted-publisher configuration and would attempt a real
publish. See `docs/public-sdk-release-checklist.md` for what's left before either is
safe to actually run.
