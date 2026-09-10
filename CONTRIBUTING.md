# Contributing to Livqeno

Thanks for being here. Livqeno is real-time communication infrastructure —
an API, SDKs and a dashboard that other people build products on — so the
bar is "someone can depend on this", not "it works on my machine". This
page is what you need to clear it.

- **Found a security problem?** Do not open an issue. See
  [SECURITY.md](./SECURITY.md).
- **Just want a good first task?** [`docs/issues/`](./docs/issues/) is ten
  real, self-contained problems, each written so you can pick it up without
  the deployment context in your head.

---

## Ground rules

Be straightforward and assume good faith. Critique code, not people.
Disagreement is fine and useful; contempt is not. Maintainers will remove
comments and contributors that make this an unpleasant place to work.

By contributing you agree your work is licensed under the repository's
[MIT licence](./LICENSE) — inbound matches outbound. There is no CLA to
sign.

---

## Getting set up

You need **Node ≥ 20** (CI uses 22), **pnpm 11.22.0**, **Docker**, and a
**Postgres connection string**.

```bash
git clone https://github.com/atulsinghhhh/Raven.git
cd Livqeno
cp .env.example .env      # then fill in real values — see below
pnpm install
```

### Postgres is not in the compose stack

Livqeno runs on managed Postgres, so `.env` needs `DATABASE_URL` and
`DIRECT_URL` before anything works. Any Postgres will do — a local one is
fine:

```bash
docker run --rm -d --name raven-dev-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=raven -e POSTGRES_DB=raven postgres:16-alpine
```

### Three secrets must be distinct

Production **refuses to boot** if `JWT_SECRET`, `RTC_TOKEN_SECRET` and
`SFU_REGISTRATION_SECRET` collide — a deployment where one leaked
credential mints all of them is worse than one that will not run.

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # RTC_TOKEN_SECRET
openssl rand -hex 32   # SFU_REGISTRATION_SECRET
```

Never commit `.env`. It is gitignored, and CI scans the full git history
for secrets on every push.

### Bring the stack up

```bash
npm run infra:up        # Redis, the SFU, coturn, MinIO, api
npm run db:migrate
npm run infra:verify    # confirms every dependency is actually healthy
npm run db:seed         # optional: demo developer, project, key, room
```

Interactive API docs land at <http://localhost:4100/docs>.

Ports, troubleshooting, and running the API on the host with hot reload:
[docs/local-development.md](./docs/local-development.md).

---

## Two things that will bite you

These are not obvious, they are not your fault, and everyone hits them.

**1. Generate the Prisma client before linting or typechecking.**

```bash
npm run prisma:generate --workspace=@raven/api
```

`prisma.config.ts` resolves `DATABASE_URL` eagerly, so this needs the
variable set even though generating a client never opens a connection.

**2. Build `packages/*` before typechecking or testing.**

```bash
npm run build --workspaces --if-present
```

`@ravenkash/react`, `@ravenkash/react-native` and the CLI resolve their
siblings through `dist/`, which a fresh checkout does not have. Skip this
and the errors look like missing dependencies (`Cannot find module
'@ravenkash/rtc'`) when they are really build ordering.

---

## Making a change

### 1. Branch

Branch from `main`, named for what it does:
`feat/simulcast-layer-selection`, `fix/chat-409-on-race`,
`docs/turn-reference`, `test/forced-relay`.

### 2. Write it in the surrounding style

Read the file you are editing first. This codebase comments the **why**,
not the what — the reason a line exists, the failure it prevents, the
alternative that was rejected. Match that. A comment restating the code is
noise; a comment explaining why the obvious approach was wrong is the most
valuable thing in the file.

### 3. Format and lint

One tool per ecosystem. Full detail in
[docs/development.md](./docs/development.md).

```bash
npm run format                                # TS/JS/JSON (Prettier)
cd services/sfu && gofmt -w . && golangci-lint run ./...
cd sdks/python && ruff format . && ruff check . && mypy src
cd sdks/flutter/raven_rtc && dart format lib test && flutter analyze --fatal-infos
```

### 4. Test what you changed

```bash
npm run test --workspaces --if-present        # TypeScript
cd services/sfu && go test -race ./...        # real Pion peers, real ICE/DTLS/SRTP
cd sdks/python && pytest
cd sdks/flutter/raven_rtc && flutter test
npm run test:e2e                              # needs a scratch Postgres + Chromium
```

**Do not weaken a test to make it pass.** If a test is wrong, fix the test
and say so in the PR. If it is flaky, say that too — a flaky test in the
media plane usually means a real race.

[docs/rtc/test-matrix.md](./docs/rtc/test-matrix.md) records what each
layer proves and what has never been exercised. If you close one of those
gaps, update it.

### 5. Add a changeset — if you touched a published package

```bash
npm run changeset
```

Pick the affected `@ravenkash/*` packages, pick `patch`/`minor`/`major`,
and write one line aimed at a release note:

> Bad: `fix bug in adapter`
> Good: `Fix a stalled subscribe when the SFU renegotiates during ICE restart`

**Not needed** for CI, docs, `apps/api`, the dashboard or the SFU — those
are not published. Full flow in [docs/releases.md](./docs/releases.md).

### 6. Commit

[Conventional Commits](https://www.conventionalcommits.org/), which is
already the convention throughout this history:

```
feat(sdk): add a chat-only entry point
fix(chat): return 409, not 500, when two creates race on the same name
docs(rtc): add the RTC reference and migration guide
ci(e2e): stop the infra step dragging in the API container
```

Types in use: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`,
`infra`. Scope is optional but usual. Write the subject so it says what
changed and why it matters — `fix(api): run migrations over a direct
connection, not the pooler` beats `fix(api): fix migrations`.

### 7. Open the PR

Say what changed, why, and how you verified it. If it touches the media
plane or the token model, say what you did *not* verify — that is more
useful than a confident claim nobody checked.

---

## What CI will run

| Workflow | Checks |
|---|---|
| `ci.yml` | Prettier · ESLint · typecheck · unit tests · builds · Python 3.10–3.13 · Flutter ×3 |
| `e2e.yml` | Redis + SFU + coturn, migrations, SFU Go tests, API e2e with real Chromium |
| `security.yml` | gitleaks · dependency review · pnpm audit · pip-audit · govulncheck |
| `codeql.yml` | CodeQL (JS/TS) |
| `sfu-publish.yml` | gofmt · `go mod tidy` · vet · golangci-lint · Go tests · Trivy (only on `services/sfu/**`) |

To run the lot locally before pushing, there is a single copy-paste block
at the end of
[docs/development.md](./docs/development.md#running-everything-ci-runs).

> **Known:** the `Format` job currently fails. Prettier was adopted without
> reformatting the existing tree, so ~345 files predate it. That is being
> fixed in one dedicated commit — it is not something your PR broke.

---

## Where things live

```
apps/api/           Control plane + signaling gateway + chat (NestJS, Prisma)
apps/dashboard/     Developer console (Next.js)
services/sfu/       The SFU. Go, Pion. The only place media is touched.
packages/           The eight published @ravenkash/* npm packages
sdks/flutter/       raven_rtc, raven_chat, raven_live
sdks/python/        raven-sdk
examples/           A runnable app per integration path
infrastructure/     docker/ · k8s/ · azure/
docs/               Architecture, references, operations, known issues
```

Start with [docs/rtc/README.md](./docs/rtc/README.md) for the RTC plane, or
[docs/chat/overview.md](./docs/chat/overview.md) for chat.

---

## Things worth knowing before a big change

- **Two planes fail independently.** The control plane decides *whether*
  you may publish or subscribe and signs a token saying so. It never
  carries media. Keep it that way.
- **Clients are never told an SFU's address.** A join learns the node's
  *name*. That is what lets the media plane be reshaped without an SDK
  release — it is how the SFU was swapped out underneath the public API.
- **The SFU is stateful for the life of a call.** Rooms live in the
  process, so a restart drops the calls on it. Deploys drain a node rather
  than rolling it.
- **Identity comes from the backend session, never a request body.**

If your change works against one of these, open an issue first and let's
talk about it — not because the design is sacred, but because changing it
is a bigger conversation than a PR review.

---

## Questions

Open an issue. There is no Discussions tab yet. For anything security
related, [SECURITY.md](./SECURITY.md) instead.
