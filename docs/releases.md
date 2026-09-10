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
  `files`, an entry point, a README and a LICENSE on disk, no
  `file:`/`link:`/`portal:` dependency ranges, and a `prepublishOnly` guard
  on any package using the workspace protocol
- `node scripts/verify-pack-manifests.mjs` — packs each package and reads
  the manifest *inside the tarball*, which is the only artefact npm will
  serve

Then `changeset publish` publishes only packages whose version is not
already on the registry, in dependency order, tags each `<package>@<version>`,
and creates one GitHub Release per package from its changelog entry.

### Checking before you push

```bash
pnpm changeset:status              # what would be released, and at what bump
pnpm --filter "./packages/*" run build   # verify-pack-manifests packs ["dist"]
node scripts/verify-package-metadata.mjs
node scripts/verify-pack-manifests.mjs
```

### The token must be a classic Automation token

`NPM_TOKEN` has to be a **classic Automation** token. A granular access
token authenticates fine and still cannot publish from CI.

The failure looks like this, at the last step of a four-minute job:

```
🦋  error an error occurred while publishing @ravenkash/client: ERR_PNPM_OTP_NON_INTERACTIVE
🦋  error $ node ../../scripts/assert-publish-safe.mjs
🦋  packages failed to publish:
🦋  @ravenkash/client@0.1.3
🦋  @ravenkash/rtc@0.3.1
```

What happened: the registry accepted the credential and then challenged
the **write** with two-factor authentication, answering with an `authUrl`
for npm's browser confirmation flow. pnpm raises `OTP_NON_INTERACTIVE`
because there is no terminal to complete it in —

> The registry requires additional authentication, but pnpm is not running
> in an interactive terminal

`--otp` does not help; it takes a human-typed code. Classic **Automation**
tokens are the credential npm exempts from 2FA on writes. Granular access
tokens are not exempt, which is also why `npm profile get` and
`npm access list packages` return 403 for them.

Fix, in order of preference:

1. npmjs.com → *Access Tokens* → *Generate New Token* → **Classic Token**
   → **Automation**, then `gh secret set NPM_TOKEN`.
2. Or set the account's 2FA level to *Authorization only* instead of
   *Authorization and writes*. This works but lowers security for
   interactive logins too.

Two things this failure is **not**, both of which the log implicates by
proximity:

- **`assert-publish-safe.mjs` did not reject anything.** pnpm echoes the
  `prepublishOnly` script line next to the error. The guard ran and passed.
- **Not the workspace-protocol bug.** `Verify packed manifests are
  installable` passes in the same run; the tarballs are fine.

Nothing is published when this happens — it fails before the first upload,
so there is no partial release to clean up. Once the token is replaced,
`gh workflow run release.yml` picks up where it stopped: `main` already
carries the bumped versions, and `changeset publish` publishes any package
whose version is not yet on the registry.

The `Preflight — can this credential publish?` step in `release.yml` now
checks what it can before the build runs, and warns when the token looks
granular. It cannot *prove* OTP-exemption — no read-only endpoint reports
it — so it warns rather than blocks.

### Never publish with npm

`pnpm publish` rewrites `workspace:*` to a concrete version when it packs.
`npm publish` does not — it uploads the manifest verbatim. Publishing a
workspace package with npm therefore produces a tarball that no installer
on earth can resolve.

This is not hypothetical. `@ravenkash/rtc@0.1.0` and
`@ravenkash/client@0.1.0` were published by hand with npm, bypassing this
workflow, and reached the registry with `workspace:*` intact:

```
npm  install @ravenkash/rtc → EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"
pnpm add     @ravenkash/rtc → ERR_PNPM_WORKSPACE_PKG_NOT_FOUND
```

They were public, downloadable and completely uninstallable for the entire
time they were the latest version, which made step 2 of the README
quickstart impossible to follow. `npm unpublish` is restricted to 72 hours,
so the fix had to be a `0.1.1` republish; 0.1.0 stays broken forever.

Three gates now cover that path, and the first is the one that matters
because it is the only one that survives a publish run from a laptop:

1. `scripts/assert-publish-safe.mjs`, wired as `prepublishOnly` in every
   publishable package. Refuses an npm-driven publish of anything using the
   workspace protocol, and refuses `file:`/`link:`/`portal:` ranges
   regardless of packer.
2. `scripts/verify-pack-manifests.mjs` in CI — packs and inspects the real
   tarball manifest. The step it replaced, `npm publish --dry-run`, lists
   tarball contents but validates no dependency ranges, which is why it
   passed on the broken 0.1.0.
3. `scripts/verify-package-metadata.mjs` fails any workspace-protocol
   package whose `prepublishOnly` guard is missing, so removing gate 1 does
   not go unnoticed.

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

- [x] Own the `@ravenkash` scope on npmjs.com — all eight packages are
      published at 0.1.0
- [ ] Enable npm trusted publishing per package, **or** set the `NPM_TOKEN`
      repository secret
- [ ] Settle the PyPI `raven-sdk` name conflict
- [ ] Confirm `.changeset/config.json`'s `ignore` list still matches the
      private apps
- [ ] `node scripts/verify-package-metadata.mjs` passes
- [ ] Land one changeset, merge the version PR, and confirm the run
      published what you expected
