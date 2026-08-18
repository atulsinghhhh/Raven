---
title: CLI
description: raven login, project management, API keys, and read-only inspection.
---

`@raven/cli` is a terminal workflow tool over the same control plane
every SDK uses — no direct database, Redis, LiveKit, or coturn access.

## Install

> **Not published to npm yet.** The commands below are what installation
> will look like once these packages are released. Until then, install
> from a local checkout — see [Installing from source](/getting-started/installing-from-source).

```bash
npm install -g @raven/cli
raven login   # opens a browser — no password paste
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
