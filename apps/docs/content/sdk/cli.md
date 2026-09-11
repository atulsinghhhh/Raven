---
title: CLI
description: Install, authenticate (browser or headless CI), manage projects and keys, and inspect a live deployment from the terminal.
---

`@ravenkash/cli` is a terminal workflow tool over the same control plane
every SDK uses — no direct database, Redis, media server, or TURN access.

It authenticates with a **dashboard session**, not a project API key. That
is what decides which commands exist: anything that would mint a real
credential is deliberately absent. See [Security](#security).

## Install

```bash
npm install -g @ravenkash/cli
```

Or run it without installing anything, which is what you want in CI:

```bash
npx @ravenkash/cli projects list
```

## Authenticate

On your own machine, `raven login` opens a browser and reuses the
dashboard session you already have — nothing to paste, no password in
your shell history:

```bash
raven login
```

In CI, a container, or over SSH there is no browser, so set an
environment variable instead. Nothing is written to disk and no home
directory is needed:

```bash
export RAVEN_TOKEN="$YOUR_SESSION_TOKEN"
export RAVEN_API_URL="https://api.your-raven-deployment.example"  # optional

raven projects list --json
```

`RAVEN_TOKEN` wins over a stored login, so you can also prefix a single
command with a different identity:

```bash
RAVEN_TOKEN="$DEPLOY_TOKEN" raven keys list --project proj_123
```

To get a token: run `raven login` once on a machine with a browser, then
copy the `token` field from `~/.raven/credentials.json` into your CI
provider's secret store. Session tokens expire — a job that starts
exiting with code `3` needs a fresh one.

A complete GitHub Actions step:

```yaml
- name: List Livqeno projects
  env:
    RAVEN_TOKEN: ${{ secrets.RAVEN_TOKEN }}
  run: npx @ravenkash/cli projects list --json
```

If a machine has no browser but does have a writable home directory,
`raven login --token "$RAVEN_TOKEN"` verifies the token against the API
and then stores it like a normal login, so later commands need no
environment variable.

`raven whoami` tells you which identity is active and where the
credential came from:

```
$ raven whoami
Logged in as: dev@example.com
Credentials:  $RAVEN_TOKEN
API:          https://api.your-raven-deployment.example
Projects:     3
Environment:  development
```

## Projects

```bash
raven projects create my-video-app     # server-generated ID, no client-side guessing
raven projects list
raven projects inspect <project>
raven projects use <project>           # sets the current project for other commands
raven projects delete <project> --yes  # --yes required outside a TTY
```

## `raven init`

Links the current directory to a project, writing a small config file so
later commands don't need `--project` repeated:

```bash
raven init
```

## API keys

```bash
raven keys create --name backend --environment production
raven keys list
raven keys revoke <keyId>
```

`--environment` accepts `dev`/`development`, `stg`/`staging`,
`prod`/`production` — an unrecognized value is refused rather than
silently defaulted. Omitting it creates a development key. See
[Environments](/production/environments).

## Rooms

```bash
raven rooms list             # live SFU participant counts, honest about unknowns
raven rooms inspect <roomId> # participants + published tracks
raven rooms create <name>
```

## Chat

```bash
raven chat overview                # activity, throughput, latency
raven chat overview --range 24h    # 15m | 1h | 24h | 7d
raven chat conversations           # or: raven chat list
raven chat connections             # WebSocket sessions
raven chat connections --state CONNECTED --limit 100
raven chat presence <conversationId>
```

Read-only by design — the CLI holds a developer session (a JWT), not a
project API key, so it can't create conversations or send messages.

## Live streams

```bash
raven streams list
raven streams list --status LIVE
raven streams inspect <streamId>          # details + live viewer count + hosts
raven streams create "Friday Q&A" --host user-123
raven streams update <streamId> --title "New title"
raven streams end <streamId>              # LIVE → ENDED, terminal
```

There is deliberately no `raven streams hosts add/remove` or
`raven streams token host/viewer` — those mint real RTC + chat
credentials, and the CLI holds a developer session (a JWT), not a
project API key, same reason `raven chat send` doesn't exist. Run those
from your own backend with `@ravenkash/server` or `raven-sdk`.

## RTC — the media plane

Inspect live rooms, participants and the server fleet:

```bash
raven rtc rooms list
raven rtc rooms get <roomId>
raven rtc rooms close <roomId>
raven rtc participants list <roomId>
raven rtc diagnostics <roomId>

raven rtc servers list
raven rtc servers get <server>
raven rtc servers drain <server>      # stop new rooms; live ones keep running
```

`raven rooms` and `raven rtc rooms` are different groups: the first reads
control-plane records, the second reads live media-server state. See
[Running the SFU](/self-hosting/sfu).

## Project scaffolding

```bash
raven init                # link this directory to a project
raven dev                 # check this directory is ready for Livqeno development
raven sdk install         # add and configure a Livqeno SDK in this project
raven logs                # stream developer-facing logs for the current project
raven version             # the CLI's own version
raven logout              # discard the stored session
```

## Connections, errors, diagnostics

```bash
raven connections list
raven connections inspect <connectionId>   # includes the Quality section — see below
raven errors list
raven errors inspect <errorId>             # category, likely cause, suggested action
raven diagnostics
```

`connections inspect` shows RTT, jitter, packet loss, bitrate, and codec
once a client's SDK has reported them — see [Diagnostics](/rtc/diagnostics).
A brand-new connection simply has nothing here yet.

## Status and config

```bash
raven status                                          # is everything up
raven config list
raven config get apiUrl
raven config set apiUrl https://api.your-raven-deployment.example
```

## JSON output for scripts

Every read command accepts `--json`:

```bash
raven status --json | jq -r '.dependencies.database'
raven projects list --json | jq -r '.[0].id'
```

## Debug mode

```bash
raven --debug status
```

Prints verbose request/response logs — never secrets. Useful when a
command's behavior doesn't match what you expected and you need to see
the actual API call.

## Exit codes

A contract with scripts and CI — stable across releases, safe to branch
on:

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | General failure |
| `2` | Invalid usage — bad flags or arguments |
| `3` | Authentication failure |
| `4` | Authorization failure |
| `5` | Not found |
| `6` | Network failure |

## Security

The CLI never has access to a project API key or a chat token's secret
half — its own session (a JWT, from `raven login`) is scoped to what a
logged-in developer can already see in the dashboard, nothing more.

A stored session token lives in `~/.raven/credentials.json` with mode
`600` (parent directory `700`). A token supplied through `RAVEN_TOKEN`
is never written to disk. No command prints a token on any code path,
including `--json` output and `--debug` traces.

Treat `RAVEN_TOKEN` as a secret: encrypted CI secrets only, never a
committed workflow file and never a `Dockerfile` `ENV` line. It grants
everything your account can do.

## Next steps

- [Errors](/reference/errors) — what a non-zero exit is reporting.
- [Running the SFU](/self-hosting/sfu) — what `raven rtc servers` manages.
- [SDKs](/sdk) — the packages the CLI does not replace.
