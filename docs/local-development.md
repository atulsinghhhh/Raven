# Local Development

This document covers Phase 1 (local infrastructure), Phase 2 (control
plane), and Phase 3 (signaling) of `INFRASTRUCTURE_PHASES.md`.
`docker compose up -d` brings up PostgreSQL, Redis, LiveKit (SFU +
signaling), coturn (TURN/STUN), and the `api` service — which now
includes both the REST control plane and the custom `/v1/rtc` WebSocket
signaling gateway, sharing the same port.

For *why* these specific technologies were chosen, see
`docs/architecture/infrastructure-decisions.md`. For what the API
actually does, see `docs/control-plane.md`. For the WebSocket signaling
layer, see `docs/signaling.md` and `docs/signaling-protocol.md`.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
  (`docker compose version` should print `v2.x` or later)
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) — install with `npm install -g pnpm` if you
  don't have it
- `openssl` (used below to generate local secrets; preinstalled on macOS
  and most Linux distributions)

No local install of PostgreSQL, Redis, LiveKit, or coturn is required or
expected — everything runs in containers.

## 1. Configure environment variables

```bash
cp .env.example .env
```

Then replace every `change-me-*` placeholder with a real local value.
Suggested generators:

```bash
# Postgres / Redis / TURN / JWT shared secrets — any of these work
openssl rand -hex 32

# LiveKit API key/secret pair (also works for LIVEKIT_API_KEY/SECRET)
docker run --rm livekit/livekit-server:v1.13.5 generate-keys
```

`.env` is git-ignored (see `.gitignore`) and must never be committed.
`.env.example` holds only placeholders and is safe to commit.

## 2. Start the infrastructure

```bash
pnpm infra:up
```

This runs `docker compose up -d`. First run pulls four base images and
**builds** the `api` image (installs dependencies, generates the Prisma
client, compiles TypeScript) — expect it to take longer the first time.
The `api` container runs `prisma migrate deploy` automatically on every
start, so the database schema is always up to date without a manual step.

## 3. Verify everything is healthy

```bash
pnpm infra:verify
```

This checks that Postgres accepts connections, Redis responds to an
authenticated `PING`, LiveKit's HTTP endpoint responds, coturn answers a
STUN binding request, the control plane's `GET /health` reports `ok`, and
all five containers are on the `raven-network` Docker network. You can
also just look at container-level health:

```bash
pnpm infra:ps
```

Every service should show `(healthy)`.

## 4. View logs

```bash
pnpm infra:logs           # all services, follow mode
docker compose logs -f livekit   # a single service
```

## 5. Stop the infrastructure

```bash
pnpm infra:down
```

Stops and removes containers but **keeps** volumes — Postgres and Redis
data survives.

## 6. Reset the infrastructure

```bash
pnpm infra:reset
```

Stops containers **and deletes volumes**, then starts fresh. Use this when
you want a genuinely empty database, or after changing something that
requires a clean state (e.g. testing a migration from scratch in a later
phase).

## Services, ports, and URLs

| Service | Container | Host port(s) | Purpose |
|---|---|---|---|
| PostgreSQL | `raven-postgres` | `5433` (not 5432 — see Troubleshooting) | Control-plane system of record |
| Redis | `raven-redis` | `6379` | Ephemeral state, cache, LiveKit coordination |
| LiveKit | `raven-livekit` | `7880` (HTTP/WS signaling), `7881` (RTC TCP fallback), `50000-50019/udp` (RTC media) | SFU + signaling |
| coturn | `raven-coturn` | `3478` (UDP+TCP, STUN/TURN control), `49160-49200/udp` (relayed media) | TURN/STUN relay |
| api | `raven-api` | `4100` (not 4000 — see Troubleshooting) | Control plane (Phase 2) — see `docs/control-plane.md` |

Local connection strings/URLs (values come from your `.env`):

- Postgres: `postgresql://raven:<password>@localhost:5433/raven`
- Redis: `redis://:<password>@localhost:6379`
- LiveKit: `ws://localhost:7880` (API key/secret from `.env`)
- coturn: `turn:localhost:3478` (credentials are now minted per-RTC-token
  as of Phase 4 — see `docs/sfu.md#turn-integration`, not a placeholder
  anymore)
- API: `http://localhost:4100` (try `curl http://localhost:4100/health`)
- API docs (interactive Swagger UI): `http://localhost:4100/docs`
- Signaling WebSocket: `ws://localhost:4100/v1/rtc?token=<RTC token>` — see
  `docs/signaling.md` and `docs/signaling-protocol.md`

Want something to try against immediately instead of registering by hand?
`pnpm db:seed` creates a demo developer, project, API key, and room, and
prints the login + API key to your terminal (shown once, like any other
key). See `docs/control-plane.md` for the full API design, or open one of:

- `examples/signaling-demo/index.html` — room presence/SDP/ICE only, no
  media (Phase 3)
- `examples/media-demo/index.html` — real camera/microphone through
  LiveKit (Phase 4, see `docs/sfu.md`) — must be served over HTTP (not
  `file://`) since browsers restrict camera access on `file://` pages;
  see `examples/media-demo/README.md`

All containers also reach each other **by service name** on the internal
`raven-network` (e.g. LiveKit connects to Redis at `redis:6379`, the `api`
container connects to Postgres at `postgres:5432` — its *internal* port,
not the host-mapped `5433` — never `localhost`) — this is what makes the
stack reproducible outside your specific machine.

## Running the API outside Docker (hot reload)

For active development on the control plane, running it directly on the
host with `pnpm dev` gives you fast TypeScript hot-reload instead of
rebuilding a Docker image on every change:

```bash
pnpm infra:up                      # keep postgres/redis/livekit/coturn in Docker
docker compose stop api            # avoid a port clash with the host-run copy
pnpm dev                            # from the repo root — runs apps/api in watch mode
```

This works because `.env`'s `DATABASE_URL`/`REDIS_URL` point at
`localhost` + the host-mapped ports (`5433`/`6379`), which is exactly what
a process running directly on your machine (not in a container) needs.

## How the SFU (LiveKit) fits in

LiveKit is both our SFU and our signaling layer (see
`docs/architecture/signaling.md` for why a separate custom signaling
server isn't being built). Concretely, in later phases:

1. A client asks our control plane (Phase 2) for a room token.
2. The control plane calls LiveKit's server SDK, using `LIVEKIT_API_KEY`/
   `LIVEKIT_API_SECRET`, to mint a scoped JWT (room, identity, publish/
   subscribe permissions).
3. The client SDK connects directly to `LIVEKIT_URL` (`ws://localhost:7880`
   locally) using that token. From there, LiveKit handles SDP/ICE/media —
   our servers are not in that path.

For local development right now (Phase 1), you can confirm LiveKit itself
is reachable with:

```bash
curl -i http://localhost:7880
```

A `200 OK` (or LiveKit's standard validate response) confirms the server
is accepting connections. Actual room/participant testing starts in
Phase 4.

## How TURN credentials work

coturn is configured with `use-auth-secret` (coturn's time-limited "REST
API" credential scheme) rather than a static username/password — nobody
has a permanent TURN login. As of Phase 4, `POST /v1/rooms/:roomId/rtc-tokens`
derives a short-lived username/credential pair from `TURN_SECRET` per
request and returns it in the response's `iceServers` array, alongside
the LiveKit token. The raw `TURN_SECRET` itself is never sent to a
client. See `docs/sfu.md#turn-integration` for the exact scheme and how
it was verified against the running coturn container.

## Troubleshooting

**A service shows `(unhealthy)` or won't start**
Check its logs: `docker compose logs <service>`. Common causes:
- `.env` wasn't created (`cp .env.example .env`) — Postgres, Redis,
  LiveKit, and the API all refuse to start with missing required
  variables (this is intentional — see the `:?...` guards in
  `docker-compose.yml`).
- A port is already in use on your host. Change the corresponding
  `*_PORT` variable in `.env`.

**Why Postgres defaults to host port 5433, and the API to 4100**
Both were discovered the hard way: many developer machines already run a
native/Homebrew Postgres on 5432, and something is very often already
listening on 4000. Docker's own internal health checks still passed in
both cases (they run *inside* the container, on the container's own
localhost), which is exactly why this kind of collision is easy to miss —
only host-side tools (`psql`, Prisma CLI, a browser hitting the API) would
have failed. If you hit `EADDRINUSE` or connect-to-the-wrong-database
symptoms, check `lsof -nP -iTCP:<port> -sTCP:LISTEN` on your host before
assuming the container is broken.

**LiveKit clients (once built in later phases) can't establish media**
`LIVEKIT_NODE_IP` defaults to `127.0.0.1`, which is correct only when the
client runs on the same machine as Docker. If you're connecting from
another device on your network, set `LIVEKIT_NODE_IP` to your machine's
LAN IP and restart (`pnpm infra:down && pnpm infra:up`).

**"Cannot create pid file" warning in coturn logs**
Harmless — coturn falls back to `/var/tmp/turnserver.pid` inside the
container and continues normally. Not a sign of misconfiguration.

**Docker Desktop and UDP port ranges**
On macOS/Windows, Docker Desktop's networking layer adds a small amount of
overhead to UDP relaying compared to native Linux. This does not affect
Phase 1 (we're only verifying the processes start and respond), but is
worth knowing before drawing conclusions about real call quality — that
kind of testing belongs to Phase 4 (SFU) and Phase 5 (STUN/TURN), not here.

**Starting over completely**
`pnpm infra:reset` handles the normal case (fresh volumes). If Docker
itself is in a bad state, `docker compose down -v --remove-orphans`
followed by `pnpm infra:up` is the manual equivalent.
