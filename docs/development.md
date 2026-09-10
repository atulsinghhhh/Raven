# Development: formatting, linting, testing

What CI checks, and how to run each of it locally before pushing.

For getting the stack *running* — Postgres, Redis, the SFU, coturn, MinIO —
see [local-development.md](./local-development.md).

---

## Tool versions

CI pins these. Match them locally and you will not be surprised by a
formatter that disagrees.

| Ecosystem | Version | Pinned in |
|---|---|---|
| Node | 22 | `.github/workflows/ci.yml` (`NODE_VERSION`) |
| pnpm | 11.22.0 | `package.json` (`packageManager`) |
| Go | 1.26.6 | `sfu-publish.yml`, `security.yml`, `e2e.yml` (`GO_VERSION`) |
| Python | 3.10 – 3.13 | `ci.yml` matrix; `requires-python = ">=3.10"` |
| Flutter | 3.47.2 | `ci.yml` (`FLUTTER_VERSION`) |
| Dart | ≥ 3.6.0 | each `pubspec.yaml` |

---

## Formatting

One formatter per ecosystem — each language's own tool, because it is
canonical there and arguing with it costs more than it settles.

| Files | Tool | Config |
|---|---|---|
| `.ts` `.tsx` `.js` `.mjs` `.json` | Prettier | `.prettierrc.json`, `.prettierignore` |
| `.go` | gofmt | — (not configurable) |
| `.py` | `ruff format` | `sdks/python/pyproject.toml` |
| `.dart` | `dart format` | — (not configurable) |

```bash
# TypeScript / JavaScript / JSON
npm run format                    # write
npm run format:check              # check (this is what CI runs)

# Go
cd services/sfu && gofmt -w .
gofmt -l .                        # lists anything unformatted

# Python
cd sdks/python && ruff format .
ruff format --check .

# Dart
cd sdks/flutter/raven_rtc && dart format lib test
dart format --output=none --set-exit-if-changed lib test
```

`.editorconfig` mirrors all of the above so your editor agrees before you
save.

The one-time Prettier adoption pass has been run: every file Prettier owns
is compliant, and the `Format` job in `ci.yml` is green alongside the Go,
Python and Dart checks. Land any future repo-wide pass as its own
commit and add its SHA to `.git-blame-ignore-revs`, so `git blame` keeps
pointing at the change that actually wrote each line rather than at the
reformat.

### What is deliberately not formatted

**Markdown and YAML.** Every doc here is hand-wrapped prose, with line
breaks chosen for how the sentence reads, and the workflow/compose files
carry long explanatory comments. Prettier would reflow both and settle
nothing. Both are in `.prettierignore`.

**Line width is 120** for TypeScript and Python. That is what the existing
code already does; narrower would have rewrapped hundreds of lines that
were fine.

---

## Linting

| Scope | Tool | Config |
|---|---|---|
| `apps/api`, `packages/*` | ESLint (flat) | `eslint.config.mjs` |
| Next.js apps | ESLint + `eslint-config-next` | `apps/*/eslint.config.mjs` |
| `services/sfu` | golangci-lint v2 | `services/sfu/.golangci.yml` |
| `sdks/python` | `ruff check` + mypy `strict` | `sdks/python/pyproject.toml` |
| `sdks/flutter/*` | `flutter analyze` + `flutter_lints` | `analysis_options.yaml` per package |

```bash
npm run lint                                # root config: apps/api + packages/*
npm run lint --workspaces --if-present      # each Next.js app's own config

cd services/sfu && golangci-lint run ./...
cd sdks/python && ruff check . && mypy src
cd sdks/flutter/raven_rtc && flutter analyze --fatal-infos
```

Install golangci-lint. Keep this in step with the version pinned in
`sfu-publish.yml`, and note that it has to be built with a Go at least as
new as the `go` directive in `services/sfu/go.mod` or it refuses to start:

```bash
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.13.2
```

The Go linter set is chosen for defects with a runtime consequence in a
long-lived concurrent media process — `errcheck`, `staticcheck`, `govet`,
`errorlint`, `nilerr`, `bodyclose`, `noctx`, `durationcheck`, `makezero`.
The opinionated-style family is deliberately off; `services/sfu/.golangci.yml`
says why for each.

---

## Testing

```bash
# TypeScript — apps/api plus all eight packages
npm run test --workspaces --if-present

# The SFU: real Pion peers, real ICE/DTLS/SRTP, real RTP forwarding
cd services/sfu && go test -race ./...
cd services/sfu && go test ./internal/room/ -run TestScale -v

# Python
cd sdks/python && pytest

# Dart
cd sdks/flutter/raven_rtc && flutter test

# End-to-end — needs a scratch Postgres and Chromium; see the README
npm run test:e2e
```

Every Flutter and Python test runs headless. No emulator, no device, no
browser is needed for anything except the e2e suite.

What each layer proves, and what has never been exercised, is stated
plainly in [rtc/test-matrix.md](./rtc/test-matrix.md).

---

## Running everything CI runs

```bash
pnpm install --frozen-lockfile     # setup — npm can't reify this pnpm workspace's node_modules
npm run prisma:generate --workspace=@raven/api
npm run format:check
npm run lint && npm run lint --workspaces --if-present
npm run build --workspaces --if-present
npm run typecheck --workspaces --if-present
npm run test --workspaces --if-present

cd services/sfu && gofmt -l . && go vet ./... && golangci-lint run ./... && go test -race ./...

cd sdks/python && ruff format --check . && ruff check . && mypy src && pytest

for p in raven_rtc raven_chat raven_live; do
  (cd sdks/flutter/$p && flutter pub get && \
   dart format --output=none --set-exit-if-changed lib test && \
   flutter analyze --fatal-infos && flutter test)
done
```

---

## Workflow map

| Workflow | What it covers |
|---|---|
| `ci.yml` | Prettier check · ESLint · typecheck · unit tests · builds · Python SDK matrix · Flutter SDK matrix |
| `e2e.yml` | Full stack: Redis + SFU + coturn, migrations, SFU Go tests, API e2e with real Chromium |
| `security.yml` | gitleaks · dependency review · pnpm audit · pip-audit · govulncheck |
| `codeql.yml` | CodeQL (JS/TS) |
| `sfu-publish.yml` | gofmt · tidy check · vet · golangci-lint · Go tests · Trivy · GHCR publish |
| `docker-publish.yml` | `apps/api` image · Trivy · GHCR · Azure deploy |
| `release.yml` | Changesets → npm → tags → GitHub Releases |

See [security.md](./security.md) and [releases.md](./releases.md).
