# Deploying Livqeno on an Azure for Students budget

This is a costed deployment plan for running Livqeno on a **$100 / 12-month
Azure for Students** credit. It exists because the obvious reading of that
offer — "put the backend, the database and the storage on Azure" — is the
wrong shape for this system, and the reason why is specific to Livqeno's
architecture rather than to Azure.

**Every dollar figure here is indicative and was correct at the time of
writing. Cloud list prices move; re-check the current rate before
committing.** The conclusions below survive a fairly wide margin of error
on the exact numbers, and where a conclusion depends on a number being
roughly right, that is called out.

## The constraint

$100 spread over 12 months is **~$8.33/month sustained**. That is one very
small VM and nothing else. The plan therefore has to spend the credit only
where Azure is competitive, and use free tiers elsewhere — not out of
frugality, but because two of Livqeno's components are actively
*mispriced* on Azure (§2, §3).

## 1. What each component actually needs

Livqeno is not one workload. It is a control plane, a media plane, and a
static frontend, and they have very different infrastructure profiles.

| Component | Hard requirement | Azure fit |
|---|---|---|
| `apps/api` — REST + signaling WS + chat WS | Long-lived WebSockets; ~1 vCPU per instance (see `docs/production/capacity-report.md` §2) | **Good** — VM or Container Apps |
| Postgres (Prisma) | Small, persistent, low latency to the API | **Workable**, but free alternatives are strictly better here |
| Redis — presence, rate limits, chat fan-out | Sub-ms RTT from the API; `REDIS_COMMAND_TIMEOUT_MS` is 2000 and a partition degrades chat | **Co-locate on the API host.** Azure Cache for Redis has no free tier |
| `services/sfu` (Go) + coturn | Public IP, wide UDP port range, **heavy egress** | **Bad** — see §2 |
| Chat attachments | S3-compatible object storage | **Bad** — see §3 |
| `apps/dashboard`, `apps/www`, `apps/docs` | Next.js static/SSR | Works, but wastes credit — see §4 |

## 2. Blocker: media egress is mispriced for an SFU

Azure includes 100 GB/month of free egress and then charges roughly
**$0.087/GB** (Zone 1). Livqeno's media plane is an egress amplifier by
design: the SFU receives one upstream copy of a track and sends one
downstream copy to every other subscriber.

For a 4-participant call at ~1.2 Mbps per stream:

```
each participant subscribes to 3 remote tracks
4 participants × 3 tracks × 1.2 Mbps = 14.4 Mbps of SFU egress
                                     ≈ 1.8 MB/s
                                     ≈ 6.5 GB per hour
```

So the free 100 GB is **roughly 15 hours of a single 4-person call per
month**, after which the same call costs about **$0.55/hour**. coturn
roughly doubles that for any participant behind a symmetric NAT, since a
relayed stream is billed on its outbound leg too (`docs/rtc/networking.md`
covers when relay is used).

That is the whole finding: one day of demo or load testing can cost more
than a month of compute. Egress, not CPU, is the binding cost on the media
plane.

Two secondary points reinforce the same conclusion:

- The SFU needs the UDP range `50000+` and coturn needs
  `TURN_MIN_PORT`–`TURN_MAX_PORT` plus 3478/5349. **Azure App Service and
  Container Apps cannot expose arbitrary UDP**, so the media plane has to
  be a VM regardless — you get none of the managed-platform benefit.
- The measured RTC ceiling in the capacity report (~25 subscriber tracks)
  is explicitly a local dev UDP-port artifact, not a capacity signal. Do
  not size a media host from it.

**Put the media plane somewhere with free bandwidth.** Both of these give
you the raw public IP and UDP ranges the SFU and coturn need:

| Option | Spec | Egress | Cost |
|---|---|---|---|
| Oracle Cloud Always Free (ARM) | 4 cores / 24 GB | 10 TB/month | $0 |
| Hetzner CX22 | 2 vCPU / 4 GB | 20 TB/month | ~€4/month |

`services/sfu` is Go, so Oracle's ARM instances are a clean target — build
for `linux/arm64` and the Dockerfile needs no change.

## 3. Blocker: Azure Blob is not a drop-in for the storage layer

`apps/api/src/modules/chat/attachments/s3-presign.util.ts` is a
hand-rolled **AWS Signature V4** presigner — deliberately, to avoid
pulling several megabytes of `@aws-sdk` into the API image for two
operations (presigned GET and PUT). Azure Blob Storage uses an entirely
different authorization scheme, so pointing `STORAGE_ENDPOINT` at Blob
does not work; it would mean writing and testing a second storage driver.

Use an S3-compatible provider instead, which is a config-only change:

```bash
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_BUCKET=raven-attachments
STORAGE_FORCE_PATH_STYLE=false   # R2 uses virtual-host style, unlike MinIO
```

**Cloudflare R2** is the pick: 10 GB free, S3-compatible, and **zero
egress fees** — which matters for attachment downloads for the same
reason §2 matters for media. Backblaze B2 works equally well. Leaving
`STORAGE_BUCKET` unset disables attachments cleanly
(`ATTACHMENTS_NOT_CONFIGURED`) if you would rather defer this.

## 4. One more disqualification worth knowing

**Azure App Service's Free (F1) tier does not support WebSockets.** That
rules it out for `apps/api` entirely — signaling and chat are both
WebSocket surfaces — independent of any pricing argument. If you want a
managed Azure platform for the API, it has to be Container Apps or a
paid App Service tier.

The Next.js apps (`dashboard`, `www`, `docs`) are the one part of the
system with a genuinely excellent free tier elsewhere. Hosting them on
Azure spends credit on the cheapest thing to host.

## 5. The plan

| Component | Where | Cost |
|---|---|---|
| `apps/api` + Redis | Azure Ubuntu VM, trimmed `docker-compose.yml` | $0 on the free B1s allowance, else ~$15/mo |
| Postgres | Supabase free tier (already in place) | $0 |
| Attachments | Cloudflare R2 | $0 |
| `services/sfu` + coturn | Oracle Cloud Always Free, or Hetzner | $0–€4/mo |
| `dashboard`, `www`, `docs` | Vercel free tier | $0 |
| **The $100 credit** | **Held in reserve** | — |

Notes on the choices:

- **Why the VM and not Container Apps.** You already have a working
  `docker-compose.yml`. A single VM running a trimmed compose file (api +
  redis only) is the shortest path and keeps Redis on loopback, which is
  what the timeout budget wants. Azure for Students' 12-month free
  services include 750 hrs/month of a **B1s** — verify your subscription's
  eligibility, since the free-services list is offer-dependent.
- **Why Postgres moves off-box.** B1s is 1 vCPU / 1 GB. That is tight for
  api + redis and will not also hold Postgres. Moving the database to a
  free managed tier buys back the RAM at no cost, and gets you backups you
  did not have to build. This has already happened — Supabase is Livqeno's
  database in every environment, so there is nothing to migrate at deploy
  time beyond setting the two connection strings.
- **Set `DATABASE_POOL_MAX` deliberately.** The default of 10 is sized for
  local dev. A free-tier managed Postgres has a low connection ceiling —
  check the provider's limit and keep `instances × poolMax` well under it.
  `docs/deployment/managed-postgres.md` covers the wiring, including the
  pooled/direct connection-string split migrations need.
- **Why hold the credit.** Kept in reserve, $100 buys a real 4 GB VM
  (B2s, ~$30/mo) for a month of load testing or a demo window, which is
  where an unfunded free tier actually hurts. Spent on steady-state
  hosting, it is gone by month four and you have nothing for the moment
  you need capacity.

## 6. Operational cautions

- **Credit exhaustion stops resources, it does not bill you.** That is
  good — no surprise invoice — but Azure eventually deallocates and
  deletes stopped resources. Never let an Azure student subscription hold
  the only copy of anything. Take `pg_dump` backups and keep them
  elsewhere.
- **Student status is re-verified.** Losing eligibility mid-year takes the
  subscription with it. Same mitigation.
- **Secrets are per-deployment, and several must be distinct.** Boot fails
  in production if `RTC_TOKEN_SECRET` collides with `JWT_SECRET` or
  `CHAT_TOKEN_SECRET`, by design — a leak of one must not mint the others.
  Generate each with `openssl rand -hex 32`, and keep
  `SFU_REGISTRATION_SECRET` distinct too: it is what lets a node register
  itself as an SFU and be handed rooms.
- **Production requires `wss://` for signaling.** Set
  `RTC_SIGNALING_URL`, or let it derive from `API_PUBLIC_URL`. RTC tokens
  travel on that connection.
- **Set `CORS_ORIGIN` to real origins.** The `*` in `.env.example` is a
  local-dev convenience — see `docs/control-plane.md#cors`.
- **Do not expose `TURN_PROMETHEUS_PORT`** publicly.
- **`bcryptjs` blocks the event loop** on every `ApiKeyAuthGuard` check —
  the measured single-instance authenticated-REST ceiling is ~13 req/s
  because of it (`docs/production/capacity-report.md` §1). On a 1 vCPU
  host this is the first thing you will hit, and it is a code fix, not a
  sizing problem. Don't buy a bigger VM to paper over it.

## Related

- `docs/production/capacity-report.md` — measured ceilings and bottlenecks
- `docs/rtc/sfu.md`, `docs/turn.md`, `docs/rtc/networking.md` — media plane
- `docs/control-plane.md` — API configuration
- `docs/environments.md` — environment isolation
- `infrastructure/k8s/README.md` — the scale-out path, when you outgrow this
