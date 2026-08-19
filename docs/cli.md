# Raven CLI — `@raven/cli`

A terminal workflow tool for Raven, sitting alongside the dashboard
(visual control center) and the SDK (integration library). The CLI talks
**only** to the Control API (`apps/api`, the same `/v1/...` surface the
dashboard uses) — it never touches PostgreSQL, Redis, LiveKit, or coturn
directly, and it does not manage infrastructure. If you want
Terraform-style provisioning, this isn't it: `raven login`, `raven
projects create`, `raven init`, `raven dev` are the whole shape.

## Installation

```bash
cd packages/cli
pnpm install
pnpm build      # tsup → dist/index.js (ESM, Node >=20)
```

The package publishes a single binary, `raven`, via `bin` in
`package.json`. This phase does **not** publish to npm — install locally
(`pnpm link --global`, or point a wrapper script at
`packages/cli/dist/index.js`) and verify before ever considering a
public release.

## Authentication

There are two ways in, and which one you want depends on whether the
machine running the CLI has a browser:

| Situation | Use |
|---|---|
| Your laptop | `raven login` — browser flow, described below |
| CI, a container, an SSH session, a cron job | `RAVEN_TOKEN` — no browser, no writable home directory needed |
| A machine with no browser but a writable home | `raven login --token <jwt>` — verifies once, then behaves like a normal login |

### Browser login (interactive)

`raven login` never asks you to paste a password into the terminal. It
reuses the dashboard's existing session-based auth (the same login the
dashboard itself uses) through a short-lived local bridge:

1. The CLI starts an ephemeral HTTP server bound to `127.0.0.1` on a
   random port, and generates a random `state` value.
2. It opens (or prints) `http://<dashboard>/cli-auth?port=<port>&state=<state>`.
3. The dashboard — where you're presumably already logged in, or will
   log in normally — shows an explicit "Authorize Raven CLI" screen
   naming your account and the local port.
4. On approval, the dashboard hands its own existing session token back
   to your browser (no new credential type is minted), which then POSTs
   `{state, token, email}` to `http://127.0.0.1:<port>/callback`.
5. The CLI checks `state` matches (rejecting anything else with `400`,
   so a stray or malicious request can't hijack the login), then writes
   the token to `~/.raven/credentials.json` and exits.

```
$ raven login
✔ Waiting for browser authentication…

If your browser doesn't open automatically, visit:
http://localhost:3000/cli-auth?port=53798&state=952eb67eced91f8ff5edde4fd9d9aa05

✔ Logged in as dev@example.com
```

### Headless login (CI, containers, SSH)

Set `RAVEN_TOKEN` and skip the login step entirely. No browser is
opened, nothing is written to disk, and no `~/.raven` directory is
required — which is what makes this the right form for a read-only
container image:

```bash
export RAVEN_TOKEN="$SOME_CI_SECRET"
export RAVEN_API_URL="https://api.raven.example"   # optional; defaults to the configured apiUrl

raven projects list --json | jq -r '.[0].id'
```

`RAVEN_TOKEN` takes precedence over `~/.raven/credentials.json`. That
ordering is deliberate: on your own machine you can prefix a single
command with a service-account token without disturbing — or being
disturbed by — your stored session.

```bash
RAVEN_TOKEN="$DEPLOY_TOKEN" raven keys list --project proj_123
```

`RAVEN_API_URL` overrides the configured `apiUrl` for one process only.
It is never written back into `~/.raven/config.json`, so an override
can't outlive the shell that set it. Use `raven config set apiUrl <url>`
when you do want it persisted.

Where the token comes from: it's the same session token the dashboard
uses. Mint one by running `raven login` on a machine that has a browser,
then copy the `token` field out of `~/.raven/credentials.json` into your
CI provider's secret store. Session tokens expire — a job that starts
failing with exit code `3` needs a fresh one, not a code change.

> Treat `RAVEN_TOKEN` as a secret. Store it in your CI provider's
> encrypted secrets, never in a committed workflow file, and never in a
> `Dockerfile` `ENV` line — it grants everything your account can do.

### `raven login --token` (no browser, but a writable home)

For a machine where the browser flow can't run but you'd rather not set
an environment variable on every invocation:

```bash
raven login --token "$RAVEN_TOKEN"
```

The token is verified against the Control API *before* anything is
written, so an expired or malformed token fails here — with exit code
`3` and an explanation — rather than at some later command where the
cause is far less obvious. On success it's stored exactly like a browser
login. The token itself is never echoed back, not even partially.

### Signing out

`raven logout` removes the local credential file and makes a best-effort
call to invalidate the session server-side; it never deletes your
account, and it always succeeds locally even if that network call fails.

If `RAVEN_TOKEN` is set, `raven logout` says so instead of claiming
success — the variable still authenticates the next command, and only
unsetting it actually signs you out of that shell.

`raven whoami` prints your identity from real data — no secrets — and
names which of the two sources the credential came from, which is
usually what you want to know when CI and your laptop disagree:

```
$ raven whoami
Logged in as: dev@example.com
Credentials:  credentials file
API:          http://localhost:4100
Projects:     3
Environment:  development
```

## Local configuration — what's stored, and where

Everything lives under `~/.raven/`:

| File | Contents | Permissions | Secret? |
|---|---|---|---|
| `~/.raven/credentials.json` | session token, email, apiUrl | `600` (dir `700`) | yes — the only secret this CLI stores permanently |
| `~/.raven/config.json` | `apiUrl`, `currentProject` | default | no |

Environment variables, all optional:

| Variable | Effect |
|---|---|
| `RAVEN_TOKEN` | Authenticates without `raven login`. Wins over the credentials file. |
| `RAVEN_API_URL` | Overrides `apiUrl` for one process. Never persisted. |
| `RAVEN_CONFIG_DIR` | Moves `~/.raven` elsewhere — used for isolated test runs. |
| `RAVEN_DASHBOARD_URL` | Dashboard origin for the browser login flow, when it isn't derivable from `apiUrl`. |

The CLI never stores a database credential, a TURN password, a
permanent API key secret, or a long-lived RTC token on disk. The one
thing it does persist — the session token — is treated the same way any
CLI with browser-based auth treats it (Vercel, Railway, `gh`): file
permissions are the boundary, not obscurity.

## Projects

```bash
raven projects create my-video-app     # server-generated ID, no client-side ID guessing
raven projects list
raven projects inspect <project>
raven projects delete <project> --yes  # --yes required outside a TTY
raven projects use <project>           # sets ~/.raven/config.json's currentProject
```

Every project-scoped command resolves *which* project to act on with a
fixed precedence, implemented once in `resolveProjectId()` and reused by
every command:

1. an explicit `--project`/`-p` flag
2. `raven.json` in the current directory (from `raven init`)
3. `currentProject` in `~/.raven/config.json` (from `raven projects use`)

If none of these resolve, the command fails with exit code `2` and a
suggestion to run `raven init` or `raven projects use`.

## `raven init` — link a directory to a project

```
$ raven init
? Select a project: (Use arrow keys)
❯ my-video-app
  E2E Test Project

✔ Linked this directory to "my-video-app".
  Wrote raven.json

Next: raven sdk install
```

Writes `raven.json`:

```json
{ "project": "4d9ec54a-18ef-4340-b2e7-d94c7549fcbf" }
```

That's the entire file — no secrets, safe to commit. `raven init` never
touches your application source code.

## SDK installation

```bash
raven sdk install            # detects npm/pnpm/yarn/bun from lockfiles (or npm_config_user_agent), runs it
raven sdk install --dry-run  # print the command instead of running it
```

## API keys

Matches the dashboard's exact security model: **the secret is shown
exactly once, at creation.**

```
$ raven keys create --name ci-key
✔ API key created.

Save this key now. It will not be shown again.

rvk_qVtTJMDyUXZ8.7w70AGj1gldhjWJuTtNt9w0SZKMWWal7AVvbOgEq3Vo
```

```
$ raven keys list
PUBLIC ID          NAME     STATUS  CREATED
rvk_qVtTJMDyUXZ8   ci-key   ACTIVE  2026-08-18
```

`raven keys list` and every other command only ever show the key's
`publicId` prefix (`rvk_...`) — the full secret never appears again, in
any output mode, in `--debug` logs, in `raven.json`, or in the local
config file. `raven keys revoke <keyId>` is immediate and permanent;
outside a TTY it requires `--yes`.

An API key must never end up in a commit, in `raven.json`, in CLI
config, or in debug/log output. Treat one the way you'd treat a
database password.

## Rooms

```bash
raven rooms list             # live SFU participant counts, honest about unknowns
raven rooms inspect <roomId> # participants + published tracks
raven rooms create <name>    # only if your project design uses persistent rooms
```

```
$ raven rooms list
NAME            LIVE PARTICIPANTS  STATUS
demo-room       4                  active
idle-room       0                  idle
unknown-room    unknown            unknown
```

A room with `liveParticipantCount: null` (SFU state genuinely
unreachable) prints `unknown`, never `0` — the CLI does not fabricate a
healthy-looking number when the underlying data isn't there.

`rooms inspect` takes the room's UUID (as printed by `rooms list` /
`rooms create`), not its display name — the Control API's room-detail
route is UUID-only. See **Known limitations** below.

## Status

```
$ raven status
Project: my-video-app
Database:  Healthy
Redis:     Healthy
SFU:       Healthy
TURN:      Healthy
```

Reflects the Control API's real `/health` response — including its
structured `503` "degraded" response, which the CLI treats as valid data
to display (not a failed request) so a down dependency shows up exactly
as `Unhealthy` rather than crashing the command. Nothing here is
fabricated: an unreachable dependency is reported as unhealthy, never
silently upgraded to healthy.

## Connections and errors (Phase 9)

Real, event-sourced RTC data from `@raven/rtc`'s best-effort telemetry —
never fabricated (see `docs/observability.md`).

```
$ raven connections list
CONNECTION            ROOM          PARTICIPANT   STATE          RECONNECTS   DURATION   STARTED
conn_p9e2ealice0001   demo-room     alice         DISCONNECTED   0            29s        8/18/2026, 1:04:06 PM

$ raven connections inspect conn_p9e2ealice0001
conn_p9e2ealice0001

Room:
demo-room
...
Timeline:

1:04:06 PM  connection_started
1:04:06 PM  connected
1:04:35 PM  disconnected
```

```
$ raven errors list
ERROR                        CATEGORY      MESSAGE                 CONNECTION            WHEN
err_1cbws806U0OtcoJ2is0w7g   TOKEN_ERROR   RTC token has expired   conn_p9e2ealice0001   8/18/2026, 1:04:35 PM

$ raven errors inspect err_1cbws806U0OtcoJ2is0w7g
TOKEN_ERROR

RTC token has expired

Likely cause:
The RTC token had already expired before (or during) the connection attempt.
Suggested action:
Mint a fresh RTC token — tokens are always short-lived by design.
```

`raven connections list` supports `--room <roomId>` and `--state
<STATE>` filters; `raven errors list` supports `--category <CATEGORY>`
and `--connection <connectionId>`. Both accept `--json`. Categories are
documented in full in `docs/error-codes.md`.

## Chat

Inspection only, and deliberately so.

The CLI authenticates with your developer session — the same JWT the
dashboard uses — and every command here reads a dashboard-facing
endpoint. Sending a message or minting a chat token needs a **project API
key**, which is a runtime credential your backend holds. The CLI doesn't
store one, and encouraging people to paste one into a terminal would
undo the point of having short-lived tokens at all.

So there is no `raven chat send`. Use `@raven/server` or `raven-sdk` from
your backend for that — see `docs/sdk/server/typescript.md` and
`docs/sdk/server/python.md`.

```bash
raven chat overview                    # activity, throughput, latency
raven chat overview --range 24h        # 15m | 1h | 24h | 7d
raven chat conversations               # or: raven chat list
raven chat connections                 # WebSocket sessions
raven chat connections --state CONNECTED --limit 100
raven chat presence conv_9WcQ4kRz1nB2xYtL
```

`chat overview` reports real counters, and says *"not measured in this
window"* rather than printing `0 ms` for a latency nobody sampled. Its
gateway figures describe the instance that served the request, not the
whole fleet — which the output states, so a multi-instance deployment
isn't misread as a cluster total.

`chat conversations` shows activity metadata: name, id, type, message
count, member count, last activity. **Never message contents.** The
endpoint behind it doesn't return them, so no flag can change that
(`docs/security/chat.md#privacy`).

`chat connections` includes a `GATEWAY` column — the thing you actually
need when one instance in a fleet starts misbehaving — and shows a live
session as `live` rather than a misleading `0s`.

`chat presence` reads Redis, not Postgres. An empty result is a real
answer: presence expires ~45 seconds after a client stops responding.

All four support `--json` and `-p/--project`.

## Diagnostics

```
$ raven diagnostics
✓ Raven API: Healthy
✓ Authentication: Healthy
✓ Signaling: Healthy
✓ SFU: Healthy
✓ TURN: Healthy

Project:
my-video-app
Active connections:
2

SDK (@raven/rtc) installed in this directory:
yes
```

Only reports what the CLI can honestly know from a server-side,
authenticated check plus the local `package.json` — it never fabricates
a browser connection's ICE/signaling state (that only exists inside a
running `@raven/rtc` client; call `room.getDiagnostics()` there instead —
see `docs/diagnostics.md`).

## Logs

```
$ raven logs
Logs are not available for this project yet.
```

The Control API doesn't yet expose a developer-facing logs endpoint, so
`raven logs` says so honestly instead of fabricating output. When that
endpoint exists, this command will use it — no separate logging backend
was built for this phase.

## Config

```bash
raven config get apiUrl
raven config set apiUrl https://api.your-raven-deployment.example
raven config list
```

Only ever holds `apiUrl` and `currentProject`. Never a place for
secrets.

## JSON output and CI/CD usage

Every data command accepts `--json`, printing exactly one JSON value to
stdout (arrays/objects, matching the shape documented above) with no
other text mixed in — safe to pipe into `jq` or parse directly:

```bash
raven status --json | jq -r '.database'
raven projects list --json | jq -r '.[0].id'
```

Non-interactive use: any command that would otherwise prompt (a
confirmation, a picker) requires `--yes` (confirmations) or `--project`
(picker) when stdout isn't a TTY, and fails fast with exit code `2`
instead of hanging, so CI never blocks on an interactive prompt.

Authenticate with `RAVEN_TOKEN` — see [Authentication](#authentication).
A complete GitHub Actions step:

```yaml
- name: List Raven projects
  env:
    RAVEN_TOKEN: ${{ secrets.RAVEN_TOKEN }}
    RAVEN_API_URL: https://api.raven.example
  run: npx @raven/cli projects list --json
```

## Exit codes

| Code | Meaning | Example |
|---|---|---|
| 0 | Success | |
| 1 | General failure | unexpected internal error |
| 2 | Invalid usage | missing required flag, missing `--yes` in a non-interactive shell, unknown command |
| 3 | Authentication failure | not logged in, expired session (`401`) |
| 4 | Authorization failure | logged in, but not allowed (`403`) |
| 5 | Not found | project/room/key doesn't exist, or you don't own it (`404`) |
| 6 | Network/API failure | Control API unreachable, `5xx`, rate-limited |

These are a stable contract for scripts — never renumbered once shipped.

## Debug mode

```bash
raven --debug status
```

Prints request/response tracing (method, path, a correlation ID per
request) to help diagnose connectivity issues. Every debug line passes
through a single redaction utility that replaces any field named like
`token`/`secret`/`key`/`password`/`credential`/`authorization` (case
insensitive) with `[redacted]` before printing — and, as a second layer,
the HTTP client never even logs response bodies or request headers in
the first place, so a freshly-created API key's secret or the bearer
token is never in scope to leak.

## Security notes

- The only permanent secret the CLI stores is the session token, under
  `~/.raven/credentials.json` (`600`, parent dir `700`). A token supplied
  via `RAVEN_TOKEN` is never written to disk at all.
- No command prints a token, in full or truncated, on any code path —
  including `--json` output, `--debug` traces, and error messages.
- API key secrets, RTC tokens, and TURN credentials are never written to
  disk by the CLI — they pass through a command's stdout once (API
  keys) or are handed off to your own application (RTC tokens), and
  that's it.
- `raven.json` and `~/.raven/config.json` hold no secrets by design —
  both are safe to commit / leave world-readable.
- No telemetry of any kind is implemented in this phase.
- All CLI → backend traffic goes through one internal HTTP client
  (`RavenApiClient`), which never retries authentication, authorization,
  validation, or not-found failures — only network errors and `5xx`
  responses, with a small bounded exponential backoff.

## Known limitations

- `raven rooms inspect` (and similar) require the room's UUID, not its
  display name — there's no name-based lookup on the backend yet.
- `raven logs` has no real backend to call yet; it says so rather than
  faking output.
- No auto-update mechanism — `raven version` compares against the
  installed build only; there's no background version check in this
  phase.
- No telemetry, so there's no built-in way for the Raven team to see
  aggregate CLI usage (deliberately, until an opt-in policy exists).
- `raven chat` is read-only. Sending messages, minting chat tokens and
  creating conversations all require a project API key, which belongs in
  your backend rather than in a terminal — use `@raven/server` or
  `raven-sdk`.
- `raven chat presence` takes a conversation's `conv_…` id, not its name.
  Same backend gap as `rooms inspect`.
