# Local Development

How to run Raven on your own machine. `docker compose up -d` brings up
Redis, the Raven SFU, coturn (TURN/STUN), MinIO (chat attachments), and
the `api` service — which carries both the REST control plane and the
`/v1/rtc` WebSocket signaling gateway on the same port.

**Postgres is not in that stack.** Raven's database is managed Postgres on
Supabase, external to Docker and shared by every environment including your
laptop — see `docs/deployment/managed-postgres.md` for the reasoning, the
two connection strings, and how migrations work against it.

For *why* these specific technologies were chosen, see
`docs/architecture/infrastructure-decisions.md`. For what the API
actually does, see `docs/control-plane.md`. For the WebSocket signaling
layer, see `docs/rtc/signaling.md`.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
  (`docker compose version` should print `v2.x` or later)
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) — install with `npm install -g pnpm` if you
  don't have it
- `openssl` (used below to generate local secrets; preinstalled on macOS
  and most Linux distributions)

No local install of Redis, the SFU, or coturn is required or expected —
they all run in containers. Postgres is neither installed nor
containerized: you need `DATABASE_URL` and `DIRECT_URL` for a Supabase
project instead (§1).

## 1. Configure environment variables

```bash
cp .env.example .env
```

Then replace every `change-me-*` placeholder with a real local value, and
fill in the Supabase database password in `DATABASE_URL` and `DIRECT_URL`
(Supabase dashboard -> Project Settings -> Database). Those two are the
only values here that point at a real shared service rather than a
container on your machine.

Suggested generators for the rest:

```bash
# Redis / TURN / JWT shared secrets — any of these work
openssl rand -hex 32

# RTC_TOKEN_SECRET and SFU_REGISTRATION_SECRET — the same generator, but
# they must be *different values*, and different from JWT_SECRET. Production
# boot refuses to start if any two of them match: a deployment where one
# leaked credential mints all of them is worse than one that will not run.
openssl rand -hex 32   # RTC_TOKEN_SECRET
openssl rand -hex 32   # SFU_REGISTRATION_SECRET
```

`.env` is git-ignored (see `.gitignore`) and must never be committed.
`.env.example` holds only placeholders and is safe to commit.

## 2. Start the infrastructure

```bash
npm run infra:up
```

This runs `docker compose up -d`. First run pulls four base images and
**builds** the `api` image (installs dependencies, generates the Prisma
client, compiles TypeScript) — expect it to take longer the first time.
A one-shot `migrate` service runs `prisma migrate deploy` and `api` waits
for it to exit successfully, so the schema is always up to date without a
manual step. That applies migrations to **Supabase**, over `DIRECT_URL` —
which is why the `migrate` service requires that variable. The `api`
service does not: the running app only ever reads `DATABASE_URL`.

If you run the API on the host instead (see below), apply migrations
yourself once:

```bash
npm run db:migrate  # prisma migrate deploy, over DIRECT_URL
```

## 3. Verify everything is healthy

```bash
npm run infra:verify
```

This checks that Supabase Postgres answers a `SELECT 1` through the same
`pg` client the app uses, Redis responds to an authenticated `PING`, the
SFU answers `/healthz` on its own port, coturn answers a STUN binding
request, the control plane's `GET /health` reports `ok`, and all five
long-running containers are on the `raven-network` Docker network.
(Five, not six: Postgres is not one of them.)

Note that two of those are *different* SFU checks, and the difference
matters when only one fails. The direct `/healthz` curl says the process
is alive. `GET /health` picks a **registered** node out of the registry
and probes that — so it also fails when the node is running but never
registered, which is the failure that makes every join return
`NO_RTC_CAPACITY`. You can
also just look at container-level health:

```bash
npm run infra:ps
```

Every service should show `(healthy)`.

## 4. View logs

```bash
npm run infra:logs        # all services, follow mode
docker compose logs -f sfu       # a single service
```

## 5. Stop the infrastructure

```bash
npm run infra:down
```

Stops and removes containers but **keeps** volumes — Redis and MinIO data
survives. The database is not affected either way; it is on Supabase.

## 6. Reset the infrastructure

```bash
npm run infra:reset
```

Stops containers **and deletes volumes**, then starts fresh. Use this when
you want empty Redis/MinIO state.

This does **not** touch the database — Supabase is outside the compose
stack, so there is no `down -v` that empties it. Resetting Raven's data now
means doing it deliberately against the hosted database, which every
environment shares; see `docs/deployment/managed-postgres.md#resetting`.

## Services, ports, and URLs

| Service | Container | Host port(s) | Purpose |
|---|---|---|---|
| Redis | `raven-redis` | `6379` | Ephemeral state, cache, fleet-wide room membership and fan-out |
| SFU | `raven-sfu` | `7000` (node link, health, metrics), `51000-51200/udp` (RTC media) | Raven's own SFU (Go/Pion) |
| coturn | `raven-coturn` | `3478` (UDP+TCP, STUN/TURN control), `49160-49200/udp` (relayed media) | TURN/STUN relay |
| api | `raven-api` | `4100` (not 4000 — see Troubleshooting) | Control plane (Phase 2) — see `docs/control-plane.md` |

Local connection strings/URLs (values come from your `.env`):

- Postgres: not local — the Supabase pooler on `:6543` (`DATABASE_URL`)
- Redis: `redis://:<password>@localhost:6379`
- SFU: `http://localhost:7000/healthz` — control only. Clients never
  connect here; media is negotiated over signaling and flows to the UDP
  range above.
- coturn: `turn:localhost:3478` (credentials are now minted per-RTC-token
  — see `docs/rtc/networking.md#turn`, not a placeholder
  anymore)
- API: `http://localhost:4100` (try `curl http://localhost:4100/health`)
- API docs (interactive Swagger UI): `http://localhost:4100/docs`
- Signaling WebSocket: `ws://localhost:4100/v1/rtc?token=<RTC token>` — see
  `docs/rtc/signaling.md`

Want something to try against immediately instead of registering by hand?
`npm run db:seed` creates a demo developer, project, API key, and room, and
prints the login + API key to your terminal (shown once, like any other
key). See `docs/control-plane.md` for the full API design, or open one of:

- `examples/signaling-demo/index.html` — room presence/SDP/ICE only, no
  media (Phase 3)
- `examples/media-demo/` — real camera/microphone through `@ravenkash/rtc`
  (see `docs/rtc/sfu.md`) — must be served over HTTP (not
  `file://`) since browsers restrict camera access on `file://` pages;
  see `examples/media-demo/README.md`

All containers also reach each other **by service name** on the internal
`raven-network` (e.g. the api connects to Redis at `redis:6379`, never
`localhost`) — this is what makes the stack reproducible outside your
specific machine. The database is the exception: it is reached at its
public Supabase hostname from inside and outside the network alike.

## Running the API outside Docker (hot reload)

For active development on the control plane, running it directly on the
host with `npm run dev` gives you fast TypeScript hot-reload instead of
rebuilding a Docker image on every change:

```bash
# One-time: tell the containerised SFU where the host-run API lives.
echo 'SFU_CONTROL_PLANE_URL=http://host.docker.internal:4100' >> .env

npm run infra:up                   # keep redis/sfu/coturn in Docker
docker compose stop api            # avoid a port clash with the host-run copy
npm run dev                         # from the repo root — runs apps/api in watch mode
```

This works because `.env`'s `REDIS_URL` points at `localhost` + the
host-mapped port (`6379`), which is exactly what a process running directly
on your machine (not in a container) needs. `DATABASE_URL` needs no such
distinction — Supabase is at the same address from everywhere.

**Don't skip the `SFU_CONTROL_PLANE_URL` line.** The SFU stays in Docker
and registers against `http://api:4100` by default — the *container*. Stop
that container, as the second command does, and Docker's DNS drops the name
with it, so the node retries forever against a host that no longer exists.
Nothing about the SFU looks wrong when this happens: the container reports
`(healthy)`, because its healthcheck is liveness on `/healthz` and knows
nothing about registration. What you actually see is `sfu: down` in the
API's `/health`, `unhealthy` next to the node in the dashboard, and joins
failing with `NO_RTC_CAPACITY`. Set the variable and recreate the node:

```bash
docker compose up -d --force-recreate sfu
docker compose logs sfu | grep -i registered
```

## How the SFU fits in

Raven owns both the signaling protocol and the SFU. The flow, end to end:

1. Your backend asks the control plane for an RTC token with a project API
   key. Never mint one in a browser.
2. The control plane signs it itself — Raven's own JWT, `aud: raven-rtc`,
   with the permissions baked in — and returns it alongside `iceServers`
   and an `endpoint`.
3. The client connects that token to **Raven's** signaling WebSocket
   (`ws://localhost:4100/v1/rtc`), not to the SFU. `room.join` allocates a
   node, and that node offers first.
4. Media flows client ↔ SFU directly over the published UDP range. The API
   is not in that path, which is why restarting it costs a signaling
   reconnect rather than a dropped call.

**Clients never learn the SFU's address.** They learn the node's *name*,
for support. That is what lets the media plane be re-shaped without an SDK
release.

Confirm the node is up and registered:

```bash
curl -s http://localhost:7000/healthz
# {"node":"sfu-local-01","region":"local","status":"ok","version":"dev"}
```

Registration is not something you configure — the node does it on boot,
using `SFU_CONTROL_PLANE_URL` and `SFU_REGISTRATION_SECRET`. If
`/healthz` answers but joins fail with `NO_RTC_CAPACITY`, registration is
what to look at: `docker compose logs sfu` will say why, and
`raven rtc servers list` shows what the control plane thinks it has.

## How TURN credentials work

coturn is configured with `use-auth-secret` (coturn's time-limited "REST
API" credential scheme) rather than a static username/password — nobody
has a permanent TURN login. `POST /v1/rooms/:roomId/rtc-tokens` derives a
short-lived username/credential pair from `TURN_SECRET` per request and
returns it in the response's `iceServers` array, alongside the RTC token.
The raw `TURN_SECRET` itself is never sent to a client. See `docs/rtc/networking.md#turn` for the exact scheme and how
it was verified against the running coturn container.

## Troubleshooting

**A service shows `(unhealthy)` or won't start**
Check its logs: `docker compose logs <service>`. Common causes:
- `.env` wasn't created (`cp .env.example .env`) — Redis, the SFU, and
  the API all refuse to start with missing required variables (this is
  intentional — see the `:?...` guards in `docker-compose.yml`). The `api`
  service additionally guards `DATABASE_URL` and `DIRECT_URL`. The SFU
  refuses to boot without `SFU_REGISTRATION_SECRET`, on purpose: a node
  that started without it would gather no rooms while still passing its
  own health check, which is the worst kind of broken.
- A port is already in use on your host. Change the corresponding
  `*_PORT` variable in `.env`.

**Why the API defaults to host port 4100**
Discovered the hard way: something is very often already listening on 4000.
Docker's own internal health check still passed (it runs *inside* the
container, on the container's own localhost), which is exactly why this
kind of collision is easy to miss — only host-side tools would have failed.
If you hit `EADDRINUSE`, check `lsof -nP -iTCP:<port> -sTCP:LISTEN` on your
host before assuming the container is broken.

Postgres used to be here too, on `5433` rather than `5432`, for the same
reason. That is moot now that there is no Postgres container — but it is
also why a stray Homebrew Postgres on your machine can no longer be
mistaken for Raven's database.

**`Can't reach database server` / `ENETUNREACH`**
Check `DATABASE_URL` uses the `aws-0-<region>.pooler.supabase.com` host,
not `db.<ref>.supabase.co` — the latter is IPv6-only on Supabase's free
tier. A paused free-tier project produces the same symptom; resume it in
the Supabase dashboard.

**A client connects to signaling but media never flows**
`SFU_PUBLIC_IP` defaults to `127.0.0.1`, which is the address ICE
advertises — correct only when the client runs on the same machine as
Docker. Connecting from another device on your network means it is being
handed an address that, from where it sits, is itself. Set `SFU_PUBLIC_IP`
to your machine's LAN IP and restart (`npm run infra:down && npm run infra:up`).

The symptom is specific and worth recognising: `room.joined` arrives, an
`sdp.offer` arrives, ICE candidates arrive — and `connectionState` never
leaves `connecting`. Everything on the control plane works, because none
of it depends on that address being reachable. `chrome://webrtc-internals`
will show candidate pairs failing their connectivity checks.

**SFU logs `registration failed, retrying` / `lookup api: no such host`**
The node is trying to register against the `api` *container* while your API
runs on the host. Docker resolves `api` only while that container is up, so
`docker compose stop api` — which the hot-reload workflow above tells you to
run — deletes the name the SFU depends on. Add
`SFU_CONTROL_PLANE_URL=http://host.docker.internal:4100` to `.env` and
`docker compose up -d --force-recreate sfu`.

`connection refused` instead of `no such host` is the other half of the same
problem: the name resolved, nothing was listening on that port. Check
`API_PORT` matches on both sides.

Either way, recovery is automatic once a heartbeat lands — a heartbeat from
an `UNHEALTHY` node promotes it straight back to `HEALTHY`, so there is
nothing to reset by hand. Worth knowing that `docker ps` showing the SFU as
`(healthy)` is not evidence of registration; only
`raven rtc servers list` and the API's `/health` are.

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
`npm run infra:reset` handles the normal case (fresh volumes). If Docker
itself is in a bad state, `docker compose down -v --remove-orphans`
followed by `npm run infra:up` is the manual equivalent.
