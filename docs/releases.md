# Releases

How every artefact Raven ships gets versioned and published: eight npm
packages, one Python package, three Dart packages, and two container
images.

Nothing here publishes on a merge to `main`. Each path has a deliberate
human step.

---

## npm — `@ravenkash/*`

Eight packages, versioned **independently** with
[Changesets](https://github.com/changesets/changesets).

| Package | Path |
|---|---|
| `@ravenkash/rtc` | `packages/sdk` |
| `@ravenkash/chat` | `packages/chat-sdk` |
| `@ravenkash/effects` | `packages/effects` |
| `@ravenkash/client` | `packages/client` |
| `@ravenkash/react` | `packages/react-sdk` |
| `@ravenkash/react-native` | `packages/react-native-sdk` |
| `@ravenkash/server` | `packages/server-sdk` |
| `@ravenkash/cli` | `packages/cli` |

`@raven/api`, `@raven/dashboard`, `@raven/docs` and `@raven/www` are
`private: true` and listed in `.changeset/config.json`'s `ignore`. They are
deployed, never published.

### The flow

```
feature/fix PR  ──(includes a changeset)──▶  main
                                              │
                        release.yml opens/updates "Version Packages" PR
                                              │
                              you review and merge that PR
                                              │
                        release.yml runs again → npm publish
                                              │
                              git tags  →  GitHub Releases
```

**1. Add a changeset with your PR**

```bash
pnpm changeset
```

Pick the affected packages, pick `patch`/`minor`/`major`, write one line
aimed at a release note. Commit the generated file in `.changeset/`.

No changeset is needed for CI, docs, `apps/api`, the dashboard or the SFU.

**2. Merge to `main`.** `release.yml` opens a **"Version Packages"** PR that
bumps versions, writes `CHANGELOG.md` per package, and deletes the consumed
changeset files. It updates itself as more changesets land.

**3. Merge the version PR.** That is the release approval. `release.yml`
runs again and, before anything is published, re-runs on the exact tree:

- `pnpm --filter "./packages/*" run build` and `typecheck`
- `pnpm -r test`
- `node scripts/verify-package-metadata.mjs` — name, version, description,
  MIT licence, `repository`/`homepage`/`bugs`, `publishConfig.access`,
  `files`, an entry point, a README and a LICENSE on disk, and no
  `file:`/`link:` dependency ranges
- `npm publish --dry-run` in each package

Then `changeset publish` publishes only packages whose version is not
already on the registry, in dependency order, tags each `<package>@<version>`,
and creates one GitHub Release per package from its changelog entry.

### Checking before you push

```bash
pnpm changeset:status              # what would be released, and at what bump
node scripts/verify-package-metadata.mjs
pnpm --filter @ravenkash/rtc exec npm publish --dry-run
```

### Versioning policy

Semver, independently per package.

- **patch** — bug fix, no API change
- **minor** — additive API
- **major** — anything a consumer must change code for

`@ravenkash/rtc` depends on `@ravenkash/effects`, and `@ravenkash/client` on
both `rtc` and `chat`, all via `workspace:*`. pnpm rewrites those to the
exact published version at pack time, and `updateInternalDependencies:
"patch"` gives dependents a patch bump when a dependency is released.

`@ravenkash/react` and `@ravenkash/react-native` take their Raven siblings as
`peerDependencies: "*"` deliberately — the application picks the version,
and there must be exactly one copy of `@ravenkash/rtc` in the tree.

### Authentication

**Preferred: npm trusted publishing (OIDC).** Configure each package on
npmjs.com to trust `atulsinghhhh/Raven` and the `Release` workflow. The
`id-token: write` permission in `release.yml` is already set; the token is
minted per run and expires, and nothing long-lived is stored in GitHub.

**Fallback: `NPM_TOKEN`.** A granular automation token in repository
secrets, for packages not yet migrated. It is never echoed, and the publish
fails loudly if it is missing rather than publishing anonymously.

> The `@ravenkash` npm scope must exist and be owned by the publishing
> account before the first publish — scoped packages fail outright
> otherwise. See `PUBLISHING.md`.

---

## Container images

Both go to GHCR, built and scanned by Trivy, publishing blocked on a
CRITICAL finding.

| Image | Source | Workflow |
|---|---|---|
| `ghcr.io/atulsinghhhh/raven-api` | `apps/api` | `.github/workflows/docker-publish.yml` |
| `ghcr.io/atulsinghhhh/raven-sfu` | `services/sfu` | `.github/workflows/sfu-publish.yml` |

### SFU

Tagged independently of the npm packages, so an SFU release does not imply
an SDK release:

```bash
git tag sfu-v0.1.0
git push origin sfu-v0.1.0
```

| Trigger | Tags pushed |
|---|---|
| tag `sfu-v0.1.0` | `v0.1.0`, `0.1`, `0`, `latest`, `sha-<commit>` |
| push to `main` (touching `services/sfu/**`) | `edge`, `sha-<commit>` |
| pull request | built and scanned, **nothing pushed** |

`latest` moves only on a release tag. A `latest` that tracked `main` would
hand anyone running `docker pull` an arbitrary commit as though it were a
release.

Multi-arch: `linux/amd64` and `linux/arm64`, cross-compiled via
`BUILDPLATFORM`/`TARGETARCH` rather than emulated. Images carry OCI labels,
SBOM and max-mode provenance.

See [docs/rtc/sfu.md](./rtc/sfu.md#official-container-image) for how to run
it.

---

## Python — `raven-sdk`

Not yet automated. CI (`ci.yml`, job `python`) builds the sdist and wheel
and runs `twine check` on every PR, so the artefact is known-good; the
upload is manual.

```bash
cd sdks/python
python -m build
twine check dist/*
twine upload dist/*
```

Bump `version` in `pyproject.toml` and keep it in step with the TypeScript
server SDK's feature set.

> **The name `raven-sdk` on PyPI is already taken by an unrelated project.**
> Resolve that before the first upload — see the note in the audit and in
> `PUBLISHING.md`.

---

## Dart — `raven_rtc`, `raven_chat`, `raven_live`

Not yet automated. CI validates each package (`flutter pub publish
--dry-run`) but never uploads.

```bash
cd sdks/flutter/raven_rtc
flutter pub publish
```

Publish in dependency order: `raven_rtc` and `raven_chat` first, then
`raven_live`. `raven_live` declares them as hosted `^0.1.0` constraints with
local `dependency_overrides`, so it cannot be published until both siblings
are on pub.dev.

---

## First release checklist

One-off, before the first real release:

- [ ] Own the `@ravenkash` scope on npmjs.com
- [ ] Enable npm trusted publishing per package, **or** set the `NPM_TOKEN`
      repository secret
- [ ] Settle the PyPI `raven-sdk` name conflict
- [ ] Confirm `.changeset/config.json`'s `ignore` list still matches the
      private apps
- [ ] `node scripts/verify-package-metadata.mjs` passes
- [ ] Land one changeset, merge the version PR, and confirm the run
      published what you expected
