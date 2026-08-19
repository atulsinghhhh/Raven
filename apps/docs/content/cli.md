---
title: CLI
description: Install, authenticate (browser or headless CI), manage projects and keys, and inspect a live deployment from the terminal.
---

`@raven/cli` is a terminal workflow tool over the same control plane
every SDK uses — no direct database, Redis, media server, or TURN access.

## Install

> **Not published to npm yet.** The commands below are what installation
> will look like once these packages are released. Until then, install
> from a local checkout — see [Installing from source](/getting-started/installing-from-source).

```bash
npm install -g @raven/cli
```

Or run it without installing anything, which is what you want in CI:

```bash
npx @raven/cli projects list
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
- name: List Raven projects
  env:
    RAVEN_TOKEN: ${{ secrets.RAVEN_TOKEN }}
  run: npx @raven/cli projects list --json
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

## Connections, errors, diagnostics

```bash
raven connections list
raven connections inspect <connectionId>   # includes the Quality section — see below
raven errors list
raven diagnostics
```

`connections inspect` shows RTT, jitter, packet loss, bitrate, and codec
once a client's SDK has reported them — see [RTC → Diagnostics](/rtc/diagnostics).
A brand-new connection simply has nothing here yet.

## Status and config

```bash
raven status                                          # is everything up
raven config get apiUrl
raven config set apiUrl https://api.your-raven-deployment.example
```

## JSON output for scripts

Every read command accepts `--json`:

```bash
raven status --json | jq -r '.database'
raven projects list --json | jq -r '.[0].id'
```

## Debug mode

```bash
raven --debug status
```

Prints verbose request/response logs — never secrets. Useful when a
command's behavior doesn't match what you expected and you need to see
the actual API call.

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
