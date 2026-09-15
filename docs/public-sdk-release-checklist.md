# Public SDK Release Checklist — Python & Flutter

Companion to [`docs/sdk-publication-audit.md`](./sdk-publication-audit.md).

**Status: Flutter (`raven_rtc`, `raven_chat`, `raven_live`) published to pub.dev at
`0.1.0` on 2026-09-15, with explicit approval, via manual `flutter pub publish` +
browser OAuth.** Python renamed from `raven-sdk` (taken on PyPI by an unrelated
project) to **`livqeno-sdk`** (confirmed available) — still unpublished, now blocked
only on PyPI Trusted Publisher setup + a git push, not on naming.

## Python — `livqeno-sdk` (`sdks/python`)

- [x] Package metadata valid (name, version, description, license, URLs — `pyproject.toml`)
- [x] Classifiers and keywords added (were previously missing)
- [x] **Final package name decided** — renamed `raven-sdk` → `livqeno-sdk`
      (confirmed available on PyPI); import path unchanged, still `from raven import
      Raven`; rebuilt and re-validated under the new name (build, twine check, clean-venv
      install + smoke test all pass)
- [x] Version selected — `0.1.0`, first release, no reason to bump pre-publish
- [x] README complete (install, auth, quickstart, resources, errors, docs links)
- [x] README branding fixed (no longer says "open-source")
- [x] Examples working — `examples/python-server`, verified accurate, unchanged
- [x] Tests passing — `pytest -q`, 75 passed
- [x] Lint passing — `ruff check .`
- [x] Format passing — `ruff format --check .`
- [x] Type checking passing — `mypy src` (strict)
- [x] Wheel builds — `python -m build`
- [x] sdist builds — `python -m build`
- [x] Artifact inspected — wheel/sdist contents listed, no secrets, no stray files
- [x] No secrets — security sweep clean (§5 of the audit)
- [x] Clean-environment install + import + client init smoke test — passed
- [x] `twine check` successful (this session's closest equivalent to a PyPI dry run —
      `twine` has no separate `--dry-run` upload mode)
- [x] GitHub release workflow ready — `.github/workflows/python-release.yml`: auto-publishes
      on a `pyproject.toml` version bump to `main`, or via `workflow_dispatch` with a typed
      `PUBLISH` confirmation. Not yet exercised.
- [ ] PyPI Trusted Publisher (or *pending* Trusted Publisher, which doesn't require the
      project to exist yet) configured for `livqeno-sdk` on pypi.org
- [ ] These workflow files, and the renamed `pyproject.toml`, pushed to `main` — nothing
      in `.github/workflows/` can run until GitHub has it; not done yet, needs your
      go-ahead since it's a push to the shared branch, not just a publish
- [ ] **PyPI publication approved and completed** — explicit go-ahead given for the
      Flutter publish; the equivalent for Python is still pending the two steps above

## Flutter — `raven_rtc`, `raven_chat`, `raven_live` (`sdks/flutter/*`) — PUBLISHED

- [x] `pubspec.yaml` valid for all three packages
- [x] Version selected — `0.1.0` each, first release
- [x] README complete for all three (install, requirements, quick start, docs links)
- [x] README branding fixed for all three (no longer says "open-source")
- [x] CHANGELOG complete for all three (each has a `0.1.0` entry describing what shipped)
- [ ] Example app — no package-level `example/` in any of the three (pub.dev score item,
      non-blocking); a real working example exists at `examples/flutter-rtc-chat` but
      lives outside the package directories
- [x] Analyzer clean — `flutter analyze --fatal-infos`, all three, no issues
- [x] Format clean — `dart format --set-exit-if-changed`, all three
- [x] Tests passing — `flutter test`: 32 (`raven_rtc`), 20 (`raven_chat`), 8 (`raven_live`)
- [x] pub.dev dry run successful — `flutter pub publish --dry-run`, all three, 0 warnings
      (`raven_live` has 2 expected informational hints about overridden dependencies)
- [x] No secrets — security sweep clean (§5 of the audit)
- [x] Package contents inspected — dry-run file listing reviewed for all three, matches
      expected `lib/`/`test/`/README/CHANGELOG/LICENSE/pubspec shape
- [x] GitHub release workflow ready — `.github/workflows/flutter-release.yml` +
      `flutter-publish-package.yml` (reusable): auto-publishes on a `pubspec.yaml`
      version bump to `main`, or via `workflow_dispatch` with a typed `PUBLISH`
      confirmation. Not yet exercised (the actual publish below was manual).
- [ ] pub.dev Automated Publishing configured per package on pub.dev's Admin tab
      (repository `atulsinghhhh/Raven`, workflow filename
      `flutter-publish-package.yml`) — required before either CI path can publish;
      today's publish was manual (`flutter pub publish` + browser OAuth), which
      doesn't need this
- [x] Publish order respected: `raven_rtc`, then `raven_chat`, then `raven_live`
- [x] **pub.dev publication approved and completed** — explicit go-ahead given
      2026-09-15; all three live at `0.1.0`:
      [raven_rtc](https://pub.dev/packages/raven_rtc) ·
      [raven_chat](https://pub.dev/packages/raven_chat) ·
      [raven_live](https://pub.dev/packages/raven_live)
- [ ] Commit the branding-fix changes (`sdks/flutter/*/README.md`) that were already
      live in what got published (pub packs from the working tree) but aren't yet in
      git history — `pub publish` warned about this each time and it was published
      anyway with your approval; low risk, but worth reconciling

## Cross-cutting, not yet done (optional, non-blocking)

- [ ] pub.dev `topics:` field for all three Flutter packages (skipped — didn't want to
      guess at pub.dev's currently-approved topic list; confirm at publish time)
- [x] `docs/releases.md` / `PUBLISHING.md` / the public docs site / the marketing site
      updated to reflect that Flutter is live — done
- [x] `examples/flutter-rtc-chat/pubspec.yaml` switched from local `path:` sources to
      hosted `^0.1.0` — done
