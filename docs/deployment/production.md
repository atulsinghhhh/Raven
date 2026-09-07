# Raven production deployment — Vercel + Azure + Supabase

The target topology: **frontends on Vercel, Postgres on Supabase,
everything else on Azure.** LiveKit is gone and is not coming back.

This document is the inspection result and the plan. Nothing here has been
deployed. Four places where the plan departs from the architecture as
originally specified are called out in §11, each with the repository
evidence that forced the change.

---

# Part 1 — Repository inspection

## 1. Current architecture

Raven is a **control plane** and a **media plane** that are deliberately
separate processes, plus a set of frontends and client SDKs.

```text
Browser / SDK
   │
   ├── HTTPS  ────────────►  apps/api        REST control plane
   ├── WSS /v1/rtc  ──────►  apps/api        signaling gateway
   ├── WSS /v1/chat/ws  ──►  apps/api        chat gateway
   │
   ├── UDP/TCP  ──────────►  services/sfu    media (SRTP), direct
   └── UDP/TCP/TLS  ──────►  coturn          STUN + TURN relay

apps/api  ──► Supabase Postgres    (Prisma 7 + @prisma/adapter-pg)
apps/api  ──► Redis                (presence, rate limits, pub/sub, locks)
apps/api  ──► S3-compatible store  (chat attachments, SigV4 presigned)
apps/api  ◄── services/sfu         node-link WS + registration/heartbeat
```

Two properties of this shape drive the whole deployment:

- **Media never traverses the API's ingress.** ICE hands a client a
  `host:port` on the SFU and the client connects to it directly. There is
  nothing to reverse-proxy.
- **The control plane is stateless per-request but stateful per-connection.**
  Chat and signaling hold long-lived WebSockets, coordinated across
  instances over Redis pub/sub — no sticky sessions required.

## 2. Services, apps, packages

| Path | Package | What it is | Deploy target |
|---|---|---|---|
| `apps/api` | `@raven/api` | NestJS: REST + signaling WS + chat WS + in-process background jobs | **Azure** |
| `services/sfu` | (Go) | Native SFU, media plane | **Azure (VM)** |
| `apps/dashboard` | `@raven/dashboard` | Next.js developer dashboard, incl. 14 BFF route handlers | **Vercel** |
| `apps/www` | `@raven/www` | Next.js landing page | **Vercel** |
| `apps/docs` | `@raven/docs` | Next.js docs site (`content/` is MDX) | **Vercel** |
| `apps/community` | `@raven-community/web` | Demo app that consumes Raven as an external customer | **Excluded** — see §10 |
| `apps/community-api` | `@raven-community/api` | Backend for the above | **Excluded** — see §10 |
| `packages/sdk` | `@corvidhq/rtc` | Browser RTC SDK, `SFUAdapter` → `raven-adapter.ts` | npm, not deployed |
| `packages/chat-sdk` | `@corvidhq/chat` | Chat client | npm |
| `packages/client` | `@corvidhq/client` | Control-plane client | npm |
| `packages/server-sdk` | `@corvidhq/server` | Server-side SDK | npm |
| `packages/react-sdk` | `@corvidhq/react` | React bindings | npm |
| `packages/react-native-sdk` | `@corvidhq/react-native` | RN bindings | npm |
| `packages/effects` | `@corvidhq/effects` | Background blur / effects | npm |
| `packages/cli` | `@corvidhq/cli` | `raven` CLI | npm |
| `sdks/flutter/*`, `sdks/python` | — | Flutter + Python SDKs (outside the pnpm workspace) | package registries |

`apps/api`'s modules: `api-keys`, `audit`, `auth`, `chat`, `health`,
`live-streams`, `metrics`, `observability`, `projects`, `rooms`,
`rtc-servers`, `rtc-tokens`, `server-api`, `signaling`, `users`,
`webhooks`. Live streaming **is** implemented (module + service +
`20260819125127_add_live_streaming` migration), so it is in scope for
Phase 4 verification.

## 3. Database and ORM

**Prisma 7.9.1**, not Drizzle. Confirmed at `apps/api/package.json`:
`prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg`. The ORM is not
being replaced.

The Supabase migration **has already largely been done in the working
tree** — this plan does not need to introduce it:

- `.env.example` documents `DATABASE_URL` (pooler `:6543`, transaction
  mode) and `DIRECT_URL` (`:5432`, session mode).
- `apps/api/prisma.config.ts` routes the schema engine to
  `DIRECT_URL || DATABASE_URL`, with `SHADOW_DATABASE_URL` optional.
- `docker-compose.yml` has **no Postgres container**; `DATABASE_URL` is
  passed straight through as an external service.
- `docs/deployment/managed-postgres.md` is the existing walkthrough.

**10 migrations** in `apps/api/prisma/migrations/`, `20260817145925_init`
through `20260907085510_add_rtc_server_registry`.

Pool sizing: `DATABASE_POOL_MAX` (default 10) is **per instance**.
`instances × poolMax` must stay under Supabase's ceiling — the `:6543`
pooler is what makes that workable.

## 4. Redis usage

Not a cache. Redis is load-bearing for correctness in five distinct roles,
across 22 files:

| Role | Where |
|---|---|
| Chat presence / typing (TTL keys) | `chat/presence`, `chat/typing` |
| Rate limiting (fixed windows) | `shared/rate-limit`, `chat/rate-limit`, `signaling/rate-limit` |
| Cross-instance pub/sub fan-out | `chat/realtime/chat-events.service.ts`, `signaling/rooms/room-events.service.ts` |
| Connection / room registries | `chat/gateway/connection-registry`, `signaling/rooms/room-registry`, `room-track-registry` |
| **Distributed lock** | `webhooks/webhook-delivery.worker.ts` (`SET NX EX`, 30s TTL) |

The pub/sub fan-out is what removes the need for sticky sessions. The lock
is what makes the background jobs safe at any replica count — see §11.1.

`REDIS_COMMAND_TIMEOUT_MS` is 2000, and presence / rate limiting / chat
fan-out **fail open** on timeout. A hung Redis degrades rather than
hard-fails, which means Redis latency needs monitoring, not just uptime.

## 5. RTC / SFU implementation

**LiveKit is fully removed.** Verified: no `livekit-server-sdk`, no
`livekit-client`, no LiveKit container, no LiveKit env vars. The ~28
remaining string matches are all historical comments explaining what
replaced what (e.g. `packages/sdk/src/internal/sfu/types.ts:52`,
`rtc-token-signer.service.ts:37`, `sfu-room-state.service.ts:27`). Nothing
imports or depends on it.

What replaced it:

| Concern | LiveKit before | Raven now |
|---|---|---|
| Media | `livekit-server` | `services/sfu` (Go, Pion), rooms in-process |
| Tokens | `AccessToken`/`TokenVerifier` | `rtc-tokens/rtc-token-signer.service.ts` |
| Room state | polling `RoomServiceClient` | SFU pushes snapshots over the node link |
| Client adapter | `livekit-adapter.ts` | `internal/sfu/raven-adapter.ts` behind `SFUAdapter` |

**SFU ↔ control plane** — the SFU registers itself and heartbeats:

- `POST /v1/rtc/servers/register` and `PUT …`, behind
  `SfuRegistrationGuard`, authenticated with `SFU_REGISTRATION_SECRET`
  (server-to-server; never handed to a client).
- The SFU dials `SFU_CONTROL_PLANE_URL` and keeps a node-link WebSocket
  open (`signaling/sfu/sfu-link.service.ts` keepalives from the API side).
- `rtc-servers/rtc-server-registry.service.ts` sweeps nodes that have not
  heartbeated within `SFU_HEARTBEAT_TIMEOUT_SECONDS` (30) and marks them
  unhealthy; `rtc-server-allocator.service.ts` stops giving them rooms.

Ports: control on `:7000/tcp` (internal only), media on
`SFU_UDP_PORT_MIN`–`MAX` (**51000–51200** by default). The SFU refuses to
boot if the range is narrower than `SFU_ROOM_CAPACITY`, and refuses to
boot without `SFU_REGISTRATION_SECRET`.

## 6. Coturn configuration

`infrastructure/docker/coturn/turnserver.conf`: `use-auth-secret`,
`listening-port=3478`, `tls-listening-port=5349`, relay range
`min-port=49160` / `max-port=49200`, `no-multicast-peers`, logs to stdout.
Compose passes quotas and `--static-auth-secret` as flags.

**How the RTC implementation talks to coturn — it doesn't, directly.**
There is no API→coturn control channel and the SFU embeds no TURN of its
own (deliberately: "an SFU that also relays is two capacity problems
sharing one process"). The only coupling is a **shared secret**:

1. `TURN_SECRET` is configured identically on coturn (`use-auth-secret`)
   and on `apps/api`.
2. On every token mint, `rtc-tokens/turn-credential.util.ts` computes
   `username = "<unix-expiry>:<identity>"` and
   `credential = base64(HMAC-SHA1(TURN_SECRET, username))`.
3. `buildIceServers()` returns `stun:`, `turn:…?transport=udp`,
   `turn:…?transport=tcp`, and — only when `TURN_TLS_PORT` is set —
   `turns:…?transport=tcp`, all pointed at `TURN_HOST:TURN_PORT`.
4. The client's ICE agent picks a path. coturn recomputes the same HMAC to
   authorize the ALLOCATE. Credentials expire with the token.

So coturn needs: the same `TURN_SECRET`, a **public hostname clients can
resolve** (`TURN_HOST` — not an internal address), and its ports open.
`TURN_INTERNAL_HOST` is separate and used only by the API's own STUN
health check.

Full detail already exists in `docs/rtc/networking.md`; it is not
duplicated here.

## 7. Dockerfiles

Only two, both production-ready and both reused as-is:

- **`apps/api/Dockerfile`** — 3-stage (deps → build → runtime),
  `node:22-alpine`, prod-only reinstall in the runtime stage, npm removed
  after installing pnpm (drops a vulnerable bundled `node-tar`), `USER
  node`, `EXPOSE 4100`.
  `CMD` is `node dist/main.js`; migrations are a separate one-shot step
  (changed in Phase 1 — see §11.4).
- **`services/sfu/Dockerfile`** — `golang:1.26-alpine` → `alpine:3.22`,
  static `CGO_ENABLED=0` binary, `USER raven` (uid 10001), `EXPOSE
  7000/tcp` plus a documentational `EXPOSE 50000-50200/udp`.

No Dockerfile exists for the frontends — correct, they go to Vercel.

## 8. Environment variables

~90 variables, grouped in `.env.example`, validated by
`apps/api/src/shared/config/env.validation.ts`. **Production adds twelve
extra hard checks** (`NODE_ENV=production` only) — boot fails, by design,
if any of these is wrong:

| Rule | Why |
|---|---|
| `RTC_TOKEN_SECRET` required, ≠ `JWT_SECRET` | A leaked session key must not mint RTC tokens |
| `CHAT_TOKEN_SECRET` required, ≠ `JWT_SECRET` | Same, for chat |
| `SFU_REGISTRATION_SECRET` required | Else any host reaching the API can register as an RTC server |
| `CORS_ORIGIN` ≠ `*` | — |
| `TURN_HOST` ≠ `localhost` | It is handed to real clients |
| `TURN_TLS_PORT` required | TURNS needs a real certificate |
| `RTC_SIGNALING_URL` must be `wss://` | RTC tokens travel on it |
| `STORAGE_ENDPOINT` must be `https://` | Signed upload URLs would otherwise be cleartext |

Secrets to generate (`openssl rand -hex 32`), all four distinct:
`JWT_SECRET`, `RTC_TOKEN_SECRET`, `CHAT_TOKEN_SECRET`,
`API_KEY_HASH_SECRET`, plus `SFU_REGISTRATION_SECRET` and `TURN_SECRET`.

## 9. Existing deployment configuration

| Artifact | State |
|---|---|
| `docker-compose.yml` | Local dev: redis, sfu, coturn, minio, minio-init, api. **No Postgres, no LiveKit.** |
| `docker-compose.scale.yml` | Multi-instance overlay |
| `infrastructure/k8s/base/` | `apps/api` only — configmap, secret (placeholder shape), deployment, service, HPA, PDB. Probes on `/health/ready` + `/health/live` |
| `infrastructure/k8s/README.md` | States explicitly that Postgres, Redis, SFU and coturn manifests are *deliberately absent* pending real infra to test against |
| `.github/workflows/` | `ci.yml`, `codeql.yml`, `e2e.yml`, `docker-publish.yml` (GHCR, **`apps/api` only**) |
| Azure config | **None.** No Bicep, no Terraform, no ARM, no `azure.yaml`, no Azure workflow |
| Vercel config | **None.** No `vercel.json` anywhere |

## 10. What must NOT be deployed

- **LiveKit** — removed. Do not reintroduce.
- **Postgres container** — already gone from compose; Supabase owns it.
- **MinIO** (`minio`, `minio-init`) — local dev only, a stand-in for a
  real S3-compatible store.
- **`apps/community` / `apps/community-api`** — a demo app that consumes
  Raven the way an external customer would, with its own database schema
  (`COMMUNITY_DATABASE_URL`, `?schema=raven_community`) and its own JWT
  secret. It is not part of the Raven product surface. *Excluded unless
  you say otherwise.*
- **`TURN_PROMETHEUS_PORT` (9641)** — must not be publicly exposed.
- **SFU `:7000`** — control only; internal network exclusively.
- **Prisma Studio**, seed scripts, `apps/api` dev deps.
- **k6 / load-test scripts** in `scripts/`.

---

# Part 2 — Where this plan departs from the spec

## 11.1 There is no separate worker to deploy

**Requested:** "Deploy Raven worker" as its own Azure service.

**Finding:** there is one entrypoint (`apps/api/src/main.ts`), one
`AppModule`, one build. All eight background jobs run in-process in every
API instance:

| Job | File |
|---|---|
| Webhook delivery | `webhooks/webhook-delivery.worker.ts` |
| Chat retention sweep | `chat/retention/chat-retention.service.ts` |
| Observability retention sweep | `observability/retention.service.ts` |
| RTC server stale sweep | `rtc-servers/rtc-server-registry.service.ts` |
| Chat heartbeat | `chat/gateway/chat.gateway.ts` |
| Signaling heartbeat | `signaling/gateway/signaling.gateway.ts` |
| SFU node-link keepalive | `signaling/sfu/sfu-link.service.ts` |

`WebhookDeliveryWorker` takes a Redis `SET NX EX` lock with a 30s TTL, so
**only one instance drains the queue regardless of replica count**, and an
instance dying mid-batch does not wedge the queue (worst case: one batch
retried, which is why every event carries an idempotent `evt_…` id).

**Plan: do not build a separate worker.** Deploy N API instances; the jobs
coordinate themselves. Splitting them out would mean a second entrypoint,
a second image, and a way to disable the jobs in the web instances — new
code, new failure modes, no benefit at this scale. `infrastructure/k8s/README.md`
already documents this as the intended shape.

Revisit only if webhook volume starts starving the event loop — at which
point the fix is a real queue, not a copy of the same process.

## 11.2 `NEXT_PUBLIC_API_URL` does not exist in this codebase

**Requested:** `NEXT_PUBLIC_API_URL=https://<AZURE_RAVEN_API_URL>`.

**Finding:** that variable appears nowhere. The dashboard is a
**backend-for-frontend**. `apps/dashboard/src/lib/api-client.ts:4`:

```ts
const API_BASE_URL = process.env.RAVEN_API_URL ?? 'http://localhost:4100';
```

Note the comment above it: *"Everything here runs server-side and talks to
the Control API — the browser never hits it directly, never sees the
JWT."* Every browser `fetch` in the dashboard is same-origin
(`/api/projects`, `/api/auth/login`, …) into one of 14 Next.js route
handlers, which then call the Control API server-side.

**Consequences:**

- The correct variable is **`RAVEN_API_URL`**, and it must **not** carry a
  `NEXT_PUBLIC_` prefix. Prefixing it would inline the value into the
  browser bundle and imply a direct-to-Azure call path that the session
  handling does not support.
- Setting `NEXT_PUBLIC_API_URL` would have no effect at all.
- **The dashboard generates no cross-origin browser traffic**, so CORS is
  not what makes the dashboard work. `CORS_ORIGIN` still matters — for SDK
  consumers and for the browser WebSocket paths below — but a CORS
  misconfiguration will not break dashboard login.
- The existing `NEXT_PUBLIC_*` vars are `NEXT_PUBLIC_DASHBOARD_URL`,
  `NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_WWW_URL` — cross-links between the
  three sites, not API endpoints.

What *does* go browser → Azure directly: `wss://…/v1/rtc` (signaling),
`wss://…/v1/chat/ws` (chat), SFU media, and coturn. Those come from
`RTC_SIGNALING_URL` and the minted ICE server list, not from a Next.js
env var.

## 11.3 Azure Blob Storage cannot back chat attachments as-is

**Requested:** "Azure Blob Storage if Raven requires object storage."

**Finding:** `apps/api/src/modules/chat/attachments/s3-presign.util.ts` is
a hand-rolled **AWS Signature V4** presigner — deliberately, to avoid
pulling `@aws-sdk/client-s3` + `s3-request-presigner` into the image for
two operations. Azure Blob uses an entirely different authorization scheme
(SharedKey / SAS). Pointing `STORAGE_ENDPOINT` at Blob **will not work**;
uploads and downloads will 403.

Three options, your call:

| Option | Work | Notes |
|---|---|---|
| **A. S3-compatible store** (Cloudflare R2, Backblaze B2) | Config only | `STORAGE_FORCE_PATH_STYLE=false`. R2 has zero egress fees, which matters for attachment downloads. **Recommended.** |
| **B. Write an Azure Blob driver** | New code + tests | A `StorageDriver` seam behind the presign util, SAS instead of SigV4. Keeps everything on Azure as specified, and is the option that honours the architecture literally |
| **C. Defer attachments** | Unset `STORAGE_BUCKET` | API returns `ATTACHMENTS_NOT_CONFIGURED` cleanly rather than half-working. Ship RTC and chat text first |

The plan below assumes **A** and flags every place that changes if you
pick B.

## 11.4 SFU and coturn cannot run on Azure's managed container platforms

Both need a **large contiguous UDP range published one-to-one** —
`docs/rtc/networking.md` is explicit that a remapped range hands clients
addresses that do not exist and silently forces every call onto TURN.
Azure Container Apps and App Service expose HTTP(S)/WebSocket ingress
only; neither can publish arbitrary UDP. `SFU_PUBLIC_IP` must also be a
real routable address the process itself cannot see.

**Therefore: SFU and coturn go on Azure VMs with static public IPs and NSG
rules.** This is not a preference; it is the only Azure compute form that
can carry the traffic.

Separately, the API image's `CMD` **used to** run `prisma migrate deploy`
on every container start. With N instances that is N concurrent migration
attempts against Supabase, through a schema engine that needs a
session-mode connection for its advisory lock. Phase 1 removed it: the
image now starts the app only, and migrations run as their own one-shot
step (§Phase 1, step 3).

---

# Part 3 — Deployment plan

## Target topology

```text
Vercel                          Azure                        Supabase
──────                          ─────                        ────────
dashboard  ──RAVEN_API_URL──►   Container App: raven-api  ──► Postgres
www                             (N instances, WS ingress)      (:6543 pooler)
docs                                  │
                                      ├──► Azure Cache for Redis
   browser ──wss://…/v1/rtc───────────┘         or Redis on the VM
   browser ──wss://…/v1/chat/ws───────┘
                                 VM: raven-media
   browser ──UDP 51000-51200────►   services/sfu  ──►:7000 internal
   browser ──UDP/TCP 3478 ──────►   coturn
   browser ──TLS 5349 ──────────►
                                 Cloudflare R2 (attachments) ◄── api
```

## Phase 1 — Supabase Postgres

Most of this is already in the working tree (§3). What remains:

1. **Create the project**, region matched to the Azure region chosen in
   Phase 2. Cross-region adds latency to every query.
2. **Take both connection strings** from Project Settings → Database. Use
   the **pooler** hostname (`aws-0-<region>.pooler.supabase.com`), not
   `db.<ref>.supabase.co` — the latter is IPv6-only on the free tier and
   is a common source of `ENETUNREACH` from small VMs and CI runners.
   - `DATABASE_URL` → `:6543` (transaction mode) — the app's pool
   - `DIRECT_URL` → `:5432` (session mode) — the Prisma CLI only
3. **Make migrations production-safe** — the one real change in this
   phase. Today `apps/api/Dockerfile`'s `CMD` migrates on boot. Move it to
   a **one-shot pre-deploy step**:
   - Run `pnpm --filter @raven/api prisma:migrate:deploy` as its own job
     (GitHub Actions step before the Azure release, or an Azure Container
     Apps job), with `DIRECT_URL` set.
   - Change the image `CMD` to `node dist/main.js` alone.
   - Rationale: N instances each running `migrate deploy` at boot is N
     concurrent schema-engine sessions contending for one advisory lock;
     through the transaction pooler that surfaces as a hang or a lock
     error rather than a clear message. One migration, then start the app.
   - **Done in Phase 1.** `apps/api/Dockerfile`'s `CMD` is now
     `node dist/main.js`, and a one-shot `migrate` service in
     `docker-compose.yml` is the local equivalent of the production job.
4. **Apply migrations**: `prisma migrate deploy` (never `migrate dev` —
   that needs a shadow database, and Supabase's pooler role cannot
   `CREATE DATABASE`).
5. **Verify all tables**: `prisma migrate status` should report 10 applied
   and nothing pending. See `docs/deployment/managed-postgres.md#verifying`.
6. **Set `DATABASE_POOL_MAX`** deliberately: `instances × poolMax` under
   Supabase's ceiling. With the free tier and 2 instances, start at 5–10.

## Phase 2 — Azure backend

### 2a. `apps/api` → Azure Container Apps

Container Apps, not App Service: it supports WebSockets, scales to
multiple replicas, and takes the existing image directly. (App Service
Free/F1 does not support WebSockets at all, which rules that tier out
outright.)

- **Image**: extend `.github/workflows/docker-publish.yml` to also push
  `services/sfu` (today it publishes `apps/api` only), or pull from GHCR.
- **Ingress**: external, HTTPS, custom domain, session affinity **off**
  (Redis pub/sub makes it unnecessary).
- **Instances**: min 2 for availability. The webhook lock makes this safe.
- **Health**: readiness `/health/ready`, liveness `/health/live`.
  - ⚠️ **Ordering dependency**: `/health/ready` returns **503** unless a
    healthy SFU is registered *and* reachable. Deploy the media VM first,
    or the API never passes readiness and the ingress will not route to
    it. This is intended behaviour, not a bug.
- **Logging**: pino already emits structured JSON on stdout
  (`LOG_LEVEL=info`) → Container Apps → Log Analytics. No code change.

### 2b. Redis

Two options:

| Option | Cost | Trade-off |
|---|---|---|
| Azure Cache for Redis (Basic C0) | ~$16/mo | Managed; no SLA on Basic; separate failure domain |
| `redis:7-alpine` on the media VM | $0 | Free, but cross-VM latency from the API, and you own persistence |

**Recommended: Azure Cache for Redis**, in the same region as the
Container App. Redis is load-bearing for presence and rate limiting (§4),
and cross-host latency shows up directly in `REDIS_COMMAND_TIMEOUT_MS`
failures. Set `REDIS_URL` with TLS.

### 2c. `services/sfu` + coturn → one Azure VM

One VM, both containers, `docker-compose` reusing the existing service
definitions. Ubuntu, static **Standard SKU public IP**.

**NSG inbound rules:**

| Port | Protocol | Source | Purpose |
|---|---|---|---|
| 51000–51200 | UDP | Any | SFU media (**must be 1:1, not remapped**) |
| 3478 | UDP + TCP | Any | STUN / TURN control |
| 5349 | TCP + UDP | Any | TURNS / DTLS |
| 49160–49200 | UDP | Any | coturn relay range |
| 7000 | TCP | **Container App subnet only** | SFU control link |
| 9641 | TCP | **Deny** | coturn Prometheus — never public |
| 22 | TCP | Your IP only | SSH |

**Required SFU env:**

```env
SFU_PUBLIC_IP=<VM static public IP>     # mandatory — see below
SFU_PUBLIC_HOST=media.<your-domain>
SFU_CONTROL_PLANE_URL=https://api.<your-domain>
SFU_REGISTRATION_SECRET=<shared with the API>
SFU_UDP_PORT_MIN=51000
SFU_UDP_PORT_MAX=51200
SFU_ROOM_CAPACITY=100                   # must be ≤ the port span
SFU_REGION=<azure region>
SFU_NODE_ID=sfu-<region>-01             # stable across restarts
```

`SFU_PUBLIC_IP` is not optional on Azure: the VM sees a private NIC
address, so without it every ICE candidate advertises an unroutable IP and
**every** call silently falls back to TURN — working, but paying relay
bandwidth for 100% of traffic.

⚠️ `services/sfu/internal/config/config.go` defaults
`SFU_CONTROL_PLANE_URL` to `http://localhost:4000`, while `API_PORT` is
`4100`. Set it explicitly; do not rely on the default.

**coturn** needs a **real TLS certificate** — `TURN_TLS_PORT` is a hard
production requirement (§8), and `infrastructure/docker/coturn/certs/`
currently holds a self-signed local pair. Issue a cert for
`turn.<your-domain>` (Let's Encrypt) and mount it. Set `TURN_HOST` to that
public hostname and `TURN_REALM` to your domain — **not** `raven.local`.

Also widen coturn's relay range before real traffic: 49160–49200 is 41
ports, sized for local dev.

### 2d. Secrets

Azure Key Vault, referenced from Container Apps; never in Git, never in
the image. Distinct values for `JWT_SECRET`, `RTC_TOKEN_SECRET`,
`CHAT_TOKEN_SECRET`, `API_KEY_HASH_SECRET` (boot fails otherwise), plus
`SFU_REGISTRATION_SECRET`, `TURN_SECRET`, `DATABASE_URL`, `DIRECT_URL`,
`REDIS_URL`, `STORAGE_SECRET_ACCESS_KEY`.

`TURN_SECRET` and `SFU_REGISTRATION_SECRET` must be **identical** on the
API and on the media VM — that shared value is the entire coupling
mechanism (§6).

### 2e. Production API config

```env
NODE_ENV=production
API_PUBLIC_URL=https://api.<your-domain>
RTC_SIGNALING_URL=wss://api.<your-domain>/v1/rtc
CORS_ORIGIN=https://dashboard.<your-domain>,https://<your-domain>
TURN_HOST=turn.<your-domain>
TURN_INTERNAL_HOST=<media VM private IP>
TURN_TLS_PORT=5349
STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
STORAGE_FORCE_PATH_STYLE=false
```

## Phase 3 — Vercel

Three projects from one monorepo, each with its root directory set:

| Project | Root | Build |
|---|---|---|
| `raven-dashboard` | `apps/dashboard` | pnpm workspace-aware |
| `raven-www` | `apps/www` | — |
| `raven-docs` | `apps/docs` | — |

**Dashboard environment variables:**

```env
RAVEN_API_URL=https://api.<your-domain>      # server-side only, NO NEXT_PUBLIC_
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.<your-domain>
NEXT_PUBLIC_DOCS_URL=https://docs.<your-domain>
NEXT_PUBLIC_WWW_URL=https://<your-domain>
```

Per §11.2: `RAVEN_API_URL` must not be `NEXT_PUBLIC_`-prefixed.

Verify frontend → Azure by exercising a **BFF route**, not a browser
network tab: `POST /api/auth/login` on the deployed dashboard should
return a session. A failure there is the Next.js server being unable to
reach Azure — check Vercel function logs, not the browser console.

## Phase 4 — Production verification

`GET /health/ready` covers four of these in one request — it probes
database, Redis, SFU (registry **and** reachability), and TURN (real STUN
binding), returning 503 with a per-dependency breakdown if any is down.

| Check | How |
|---|---|
| Frontend loads | All three Vercel domains |
| Authentication works | `POST /api/auth/login` on the dashboard |
| Frontend → Azure API | Same request; failure appears in Vercel function logs |
| API → Supabase | `/health/ready` → `dependencies.database: "up"` |
| API → Redis | `/health/ready` → `dependencies.redis: "up"` |
| Worker works | Create a webhook endpoint, trigger an event, confirm delivery. **One** instance should log the drain (the Redis lock) |
| RTC connection | Mint a token via the dashboard's test-token panel, join from two browsers |
| STUN works | `/health/ready` → `dependencies.turn: "up"` (a real STUN binding request) |
| TURN fallback | Force relay: Chrome `chrome://webrtc-internals`, confirm a `relay` candidate pair is selected. Test from a restrictive network |
| Chat works | Send, react, typing indicator, presence — across two instances to prove Redis fan-out |
| Live streaming | Implemented (§2); exercise `live-streams` endpoints |
| No LiveKit | `grep -ril livekit --include='*.json' .` over lockfiles and manifests → no dependency hits |
| Secrets not exposed | `curl` the dashboard bundle for secret substrings; confirm no `NEXT_PUBLIC_` var holds one |
| CORS correct | Cross-origin `fetch` from a disallowed origin must fail; the WS paths must accept the allowed ones |

Add two that the requested list omits but this architecture needs:

- **SFU registration**: `GET /v1/rtc/servers` (dashboard) shows the node
  healthy, heartbeating, region correct.
- **ICE candidates carry the public IP**: inspect a minted token's
  `iceServers` and the SDP — a private `10.x`/`172.x` candidate means
  `SFU_PUBLIC_IP` is wrong and every call is silently relaying.

---

# Part 4 — What is missing

Not inventable from the repository. Needed before Phase 2:

1. **Azure subscription details** — region, resource group, and whether
   Container Apps is available/acceptable to you.
2. **Domain names** — `api.`, `turn.`, `media.`, `dashboard.`, `docs.`,
   apex. Nine env vars depend on these.
3. **A TLS certificate for coturn.** Hard production requirement; only a
   self-signed dev pair exists today.
4. **A storage decision** — §11.3 option A, B, or C.
5. **A Redis decision** — Azure Cache vs. on-VM.
6. **All production secret values** — six to generate, four of which must
   be mutually distinct.
7. **Supabase project + both connection strings.**
8. **A community-apps decision** — excluded by default (§10).
9. **No Azure IaC exists.** Bicep/Terraform would have to be written from
   scratch, or Phase 2 done through the portal/CLI. Say which.
10. **No SFU image publishing.** `docker-publish.yml` covers `apps/api`
    only; `services/sfu` needs adding.

## Related

- `docs/deployment/managed-postgres.md` — Phase 1 in detail
- `docs/deployment/azure-student.md` — cost analysis if this runs on a $100 student credit
- `docs/rtc/networking.md` — ports, ICE, TURN
- `docs/rtc/scaling.md` — SFU draining on deploy
- `docs/rtc/security.md` — token/secret separation
- `infrastructure/k8s/README.md` — the single-Deployment rationale
- `docs/production/capacity-report.md` — measured ceilings
