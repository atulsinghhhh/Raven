# Livqeno on Azure — media plane (Phase 2)

Azure CLI scripts, run in order. Every one is idempotent: re-running skips
what already exists. There is no Bicep or Terraform here on purpose — the
resource count is small enough that a reviewable shell script beats a
templating system, and `az` error messages are far more direct. Revisit that
if this grows past a dozen resources or needs multiple environments.

```bash
./01-foundation.sh     # resource group + container registry
./02-network.sh        # VNet, subnets, static IPs, NSGs
./03-vms.sh            # SFU VM + coturn VM
./04-images.sh         # build + push raven-sfu to ACR
./05-secrets.sh        # Key Vault + generated secrets
./06-deploy-sfu.sh     # SFU + Redis containers
./07-deploy-coturn.sh  # coturn container
./08-verify.sh         # acceptance tests (read-only)

./rotate-turn-secret.sh  # after rotating turn-secret in Key Vault — see Secrets
```

`00-variables.sh` holds every name, size and port. It contains no secrets.

## The control plane (Phase 3)

`raven-api` runs on Azure Container Apps in `raven-env`, VNet-integrated
into `snet-apps` so it reaches Redis and the SFU privately.

```
https://raven-api.salmontree-6311a7e1.eastasia.azurecontainerapps.io
```

0.5 vCPU / 1 GiB, min 1 / max 2 replicas, `activeRevisionsMode: Multiple`.
Image pulled with the app's **system-assigned managed identity** (AcrPull on
`ravenacr`) — no registry password anywhere.

**Only one Container Apps environment is allowed per Azure for Students
subscription.** Creating `raven-env` required deleting a pre-existing
`flanca-env`. Export any app you are about to displace with `az containerapp
show -o yaml` first — Azure redacts secret *values* from that export, so it
records the shape to rebuild from, not the secrets.

### Variables the API does NOT have

`SFU_URL` and `SFU_PUBLIC_IP` are not part of the API's configuration
schema and setting them does nothing. SFU nodes **self-register** into the
`rtc_servers` table with their own `internalUrl`, and the API discovers them
from there. `SFU_PUBLIC_IP` is SFU-side only (`06-deploy-sfu.sh`).

The API's SFU keys are `SFU_REGISTRATION_SECRET`,
`SFU_HEARTBEAT_TIMEOUT_SECONDS` and `SFU_DEFAULT_REGION`.

`DIRECT_URL` is deliberately absent from the app: the running API never
reads it, and only the migration job should hold a session-mode connection.

### Five variables with no defaults

`SIGNALING_MAX_PARTICIPANTS_PER_ROOM`, `SIGNALING_MAX_MESSAGE_BYTES`,
`SIGNALING_MAX_MESSAGES_PER_WINDOW`, `SIGNALING_MESSAGE_WINDOW_SECONDS`,
`SIGNALING_MAX_CONNECTIONS_PER_WINDOW` are **required** by the base
validation schema, not just in production. Omitting them crash-loops the
container with `Invalid environment configuration`. Fifteen variables are
required in total; the rest carry defaults.

### Why the probes use /health/live

Both the liveness and readiness probes hit `/health/live`, not
`/health/ready`. `/health/ready` returns 503 until an SFU is registered, and
an SFU registers *by calling this API through this ingress* — so gating
ingress on it deadlocks a cold start: no traffic, no registration, never
ready.

`/health/ready` is unmodified and is still the real dependency signal. It is
what `tests/api-e2e.sh` and the CI health gate check; it is simply not the
ingress gate.

### Migrations

A one-shot Container Apps job (`raven-migrate`), never the API's startup
command. `apps/api/Dockerfile`'s `CMD` is `node dist/main.js` alone.

`az containerapp` joins repeated `--args` values **with commas**, which
corrupts a container command (`/bin/sh: illegal option -,`). Both the job
and the app are therefore defined via `--yaml`, where `command` and `args`
stay proper arrays.

## Rollback

Revisions are kept, never auto-pruned. List them:

```bash
az containerapp revision list -n raven-api -g raven-production \
  --query "reverse(sort_by([].{name:name,created:properties.createdTime,state:properties.runningState,traffic:properties.trafficWeight},&created))" -o table
```

Shift all traffic back to a known-good revision:

```bash
az containerapp ingress traffic set -n raven-api -g raven-production \
  --revision-weight <good-revision>=100
```

That is the fast path — it moves traffic without a new deployment. To pin
the app back to a previous **image** instead:

```bash
az acr repository show-tags -n ravenacr --repository raven-api -o table
az containerapp update -n raven-api -g raven-production \
  --image ravenacr.azurecr.io/raven-api:<older-sha>
```

Then re-point traffic at the latest revision:

```bash
az containerapp ingress traffic set -n raven-api -g raven-production --revision-weight latest=100
```

A rollback does **not** roll back the database. Migrations are forward-only;
a revision older than the current schema must still be compatible with it.

Deactivate a bad revision only after a good one is serving:

```bash
az containerapp revision deactivate -n raven-api -g raven-production --revision <bad>
```

## Hazard: one database, every environment

`rtc_servers` is shared between local development and Azure, because
`DATABASE_URL` points every environment at the same Supabase project.

A developer running `pnpm infra:up` registers an SFU named `sfu-local-01`
with `internalUrl=http://sfu:7000` into the **production** fleet. This was
observed: the deployed API's readiness probe selected that node and reported
`sfu: down`, because `pickHealthyForProbe()` filters on
`status: HEALTHY` only — there is no region or environment filter.

It is worse than a noisy probe. `RtcServerAllocator.pickServer()` prefers
the requested region but **falls back to any region rather than failing the
call**, so a production room can be allocated to a laptop, handing clients a
media address nothing can reach.

Mitigations, in order of preference: give each environment its own Supabase
project; or add an environment column to `rtc_servers` and filter on it; or,
at minimum, do not run a local SFU against the production database. The
staleness sweeper marks a stopped local node UNHEALTHY within
`SFU_HEARTBEAT_TIMEOUT_SECONDS`, which limits but does not remove the window.

## Region

**eastasia.** The intent was southeastasia, to sit beside the Supabase
project in `ap-southeast-1` — the API↔Postgres round trip is on every
authenticated request. This subscription carries the Azure for Students
policy *Allowed resource deployment regions*, which permits only
`indiasouthcentral`, `koreacentral`, `uaenorth`, `eastasia`, `centralindia`.
eastasia is the closest of those to Singapore.

```bash
az policy assignment list --query "[0].parameters"
```

Region cannot be changed in place; it means rebuilding everything.

## VM sizes

**eastasia has no legacy B-family capacity at all.** `Standard_B2s` fails
preflight with `SkuNotAvailable — Capacity Restrictions`; only `*_v2` sizes
exist there. Quotas: Total Regional 6 vCPUs, Basv2 10, Bsv2 10.

| VM | Size | vCPU / RAM | Why |
|---|---|---|---|
| `raven-sfu-01` | `Standard_B2als_v2` | 2 / 4 GB | Media plus the Redis container. Redis is load-bearing for presence, rate limits and chat fan-out — not a cache — so the 4 GB matters. |
| `raven-coturn-01` | `Standard_B2ats_v2` | 2 / 1 GB | Smallest size available. coturn is network-bound; 1 GB is ample. 2 vCPUs is not a choice — no 1-vCPU v2 size exists. |

## Network

```
10.10.0.0/16  raven-vnet
├── 10.10.1.0/24  snet-media   raven-sfu-01 (.4), raven-coturn-01 (.5)
└── 10.10.4.0/23  snet-apps    RESERVED — Phase 3 Container Apps
```

`snet-apps` is claimed now because a Container Apps environment cannot be
moved into a VNet after creation, and it needs a dedicated subnet of at
least /23. It has to be VNet-integrated because Redis lives on a VM rather
than in Azure Cache, and Redis must never be public.

### Every open port, and why

**`raven-sfu-nsg`**

| Port | Proto | Source | Why |
|---|---|---|---|
| 51000–51200 | UDP | Internet | SRTP media. Clients connect to the SFU directly — media never crosses an ingress. Must be published 1:1: ICE advertises the exact port bound, so any remap hands out addresses that do not exist. Range from `services/sfu/internal/config/config.go`. |
| 7000 | TCP | `10.10.4.0/23` | Node link, `/healthz`, `/readyz`, `/metrics`. The API only. Never Internet. |
| 6379 | TCP | `10.10.4.0/23` | Redis. Private subnet only, and additionally bound to the private NIC in compose. |
| 22 | TCP | operator IP `/32` | SSH. |

**`raven-coturn-nsg`**

| Port | Proto | Source | Why |
|---|---|---|---|
| 3478 | UDP | Internet | STUN binding + TURN allocate. The normal path. |
| 3478 | TCP | Internet | TURN over TCP — the fallback where UDP is blocked outright. |
| 49160–49200 | UDP | Internet | Relay range. coturn allocates a relay address per allocation and the peer sends to it. Matches `turnserver.conf`'s `min-port`/`max-port`. |
| 22 | TCP | operator IP `/32` | SSH. |

**Deliberately closed:** `5349` (TURNS — no certificate yet; advertising a
TLS listener that fails the handshake wastes a client's ICE candidate),
`9641` (coturn Prometheus — never public). Azure's default inbound deny
covers everything else; no explicit deny rule is added, since one would only
obscure that.

Note on testing: Azure keeps the private source address for VM→VM traffic
sent to a public IP, so a rule sourced from `Internet` does not match it.
TURN has to be tested from outside the VNet.

## The two settings that fail silently

Both make a broken deployment look healthy.

**`SFU_PUBLIC_IP`** — an Azure VM never sees its public address on the NIC
(1:1 NAT). Without this set to the static public IP, the node advertises
`10.10.1.4`, every ICE candidate is unroutable, and the only calls that
connect are the ones falling back to TURN. They work, and they bill relay
bandwidth for 100% of traffic.

**coturn's `external-ip=<public>/<private>`** — the same failure one layer
over. Without it coturn hands out relay candidates pointing at
`10.10.1.5`; the allocation succeeds and the media never arrives.

`08-verify.sh` asserts both, the second by reading the actual
`XOR-RELAYED-ADDRESS` off a live allocation and failing if it is private.

## coturn fails open, so the deploy asserts

coturn does **not** exit when it cannot read its config file. It logs a
warning and continues on defaults — no realm, **no authentication** — an
open relay that anyone can allocate through, which passes every "is the
container up" check.

This happened during Phase 2: the config was written mode 600 owned by the
SSH user, and the image runs as `nobody:nogroup` (uid 65534). Fix: the file
is chowned to 65534 and stays 600. `07-deploy-coturn.sh` now greps the log
for the configured realm and **stops the container** if it is absent, and
`08-verify.sh` independently confirms a forged credential gets a 401.

## Secrets

Key Vault `raven-kv-ea1`, access-policy authorization. Generated by
`05-secrets.sh` (32 random bytes, hex) and never printed or committed:

```
jwt-secret  rtc-token-secret  chat-token-secret  api-key-hash-secret
sfu-registration-secret  turn-secret  redis-password
database-url  direct-url          # copied from local .env, not generated
```

`jwt-secret`, `rtc-token-secret`, `chat-token-secret` and
`sfu-registration-secret` must stay mutually distinct — the API refuses to
boot in production otherwise (`apps/api/src/shared/config/env.validation.ts`),
so a leak of one cannot mint the others.

`turn-secret` is the *entire* coupling between Livqeno and coturn. Livqeno mints
`username="<expiry>:<identity>"`, `credential=base64(HMAC-SHA1(secret, username))`
per token; coturn recomputes the same hash. There is no API→coturn control
channel and none should be added.

### Rotating turn-secret

Because that coupling is a copied value rather than a lookup, rotation is
two steps and skipping the second one breaks TURN silently:

```bash
az keyvault secret set --vault-name raven-kv-ea1 -n turn-secret \
  --value "$(openssl rand -hex 32)" --output none
./rotate-turn-secret.sh          # push it to coturn and restart
```

`07-deploy-coturn.sh` reads Key Vault at *deploy* time and bakes the value
into `/opt/raven/turnserver.conf`, while the API and `08-verify.sh` read Key
Vault *live*. Rotate without the second step and every reader moves except
the relay, which then rejects every Livqeno-minted credential with a 401 while
the forged-credential control still passes — auth is working, the two sides
just disagree about the key. It reads as a broken HMAC implementation and is
not one. `08-verify.sh` now prints both fingerprints and names this on
failure, and `rotate-turn-secret.sh` is idempotent: run it any time, it
compares fingerprints first and does nothing if coturn is already current.

`rotate-turn-secret.sh` never generates a secret — that stays in
`05-secrets.sh`, whose `set_generated` deliberately leaves an existing
secret alone.

On the VMs, secrets land in `/opt/raven/.env` (mode 600). **Hardening not
yet done:** give each VM a managed identity with *Key Vault Secrets User*
and let it fetch its own secrets at boot, taking the operator's workstation
out of the path. Same for ACR — the VMs currently use the admin user. That
change would also retire `rotate-turn-secret.sh`: a VM that can read Key
Vault itself can be told to re-read, and no value would need copying.

## Cost

Roughly **$95/month** on pay-as-you-go, against a $100 student credit — so
about **five weeks**. The media plane alone was ~$62; the always-on
Container App adds ~$33 (0.5 vCPU and 1 GiB running continuously, minus the
monthly free grant of 180k vCPU-seconds / 360k GiB-seconds).

Ways to cut it, cheapest first: drop the app to 0.25 vCPU / 0.5 GiB (~$17/mo
instead of ~$33); deallocate both VMs between test sessions (~$12/mo floor);
`minReplicas: 0` is **not** a safe saving here — a scaled-to-zero API stops
answering SFU heartbeats, so the fleet goes unhealthy and RTC breaks until
something wakes it.

| Item | ~$/mo |
|---|---|
| `raven-sfu-01` B2als_v2 | 31 |
| `raven-coturn-01` B2ats_v2 | 15 |
| 2 × Standard static public IP | 7 |
| ACR Basic | 5 |
| 2 × 30 GB StandardSSD | 5 |
| Key Vault | ~0 |
| `raven-api` Container App (0.5 vCPU / 1 GiB, always-on) | ~33 |

Egress is extra and metered (100 GB/month free, then ~$0.087/GB) — see
`docs/deployment/azure-student.md`, which is why the media plane is the
expensive part of this system.

To stretch the credit, deallocate the VMs when not testing. Compute stops
billing; disks and IPs (~$12/mo) do not.

```bash
az vm deallocate -g raven-production -n raven-sfu-01 --no-wait
az vm deallocate -g raven-production -n raven-coturn-01 --no-wait
az vm start -g raven-production -n raven-sfu-01     # SFU_PUBLIC_IP survives: the IP is static
```

## Custom domains — ravenstack.online

DNS for `ravenstack.online` is hosted in an **Azure DNS zone** in this
resource group, fully populated. It is not yet authoritative: the registrar
(GoDaddy, `ns13/ns14.domaincontrol.com`) still answers for the domain.

Vercel could not host the zone — a third-party-registered domain added as a
*project* domain gets no zone, and the API returns
`ravenstack.online is not a DNS zone`. Azure DNS was used instead, so every
record is managed with the same `az` credentials as the rest of this
deployment.

**One manual step remains.** At the registrar, replace the nameservers with:

```
ns1-04.azure-dns.com
ns2-04.azure-dns.net
ns3-04.azure-dns.org
ns4-04.azure-dns.info
```

Zone contents (all verified against `dig @ns1-04.azure-dns.com`):

| Type | Name | Value | Serves |
|---|---|---|---|
| A | `@` | `76.76.21.21` | Landing (Vercel) |
| CNAME | `www` | `cname.vercel-dns.com` | Landing |
| CNAME | `app` | `cname.vercel-dns.com` | Dashboard |
| CNAME | `docs` | `cname.vercel-dns.com` | Docs |
| CNAME | `api` | `raven-api.…eastasia.azurecontainerapps.io` | API |
| TXT | `asuid.api` | Container App `customDomainVerificationId` | Azure ownership check |
| A | `turn` | `40.83.92.152` | coturn |

Then run the cutover, which is gated on those records resolving publicly and
refuses to run early:

```bash
./14-custom-domains.sh
./tests/verify-domains.sh ravenstack.online
```

It binds `api.ravenstack.online` with an **Azure-managed certificate**,
issues a Let's Encrypt certificate for `turn.ravenstack.online`, moves the
coturn realm onto it, then updates `API_PUBLIC_URL`, `RTC_SIGNALING_URL`,
`CORS_ORIGIN` and `TURN_HOST`, and repoints the dashboard's `RAVEN_API_URL`.

Nothing was switched over in advance, deliberately: `TURN_HOST` feeds every
client's `iceServers`, so setting it before `turn.ravenstack.online`
resolves would break relay for real users. `TURN_INTERNAL_HOST` stays on the
private `10.10.1.5` address — it is only the API's own STUN probe.

The Azure-generated FQDN is never removed, so the cutover widens access
rather than moving it.

## Still required

1. **A TURN hostname**, plus an A record to the coturn public IP. The realm
   is currently the bare IP.
2. **A TLS certificate** for it. `TURN_TLS_PORT` is a hard production
   requirement — `NODE_ENV=production` will not boot without it. Steps are
   in the `PENDING` block at the foot of `07-deploy-coturn.sh`.
3. **Attachment storage.** Unchanged and untouched this phase. Azure Blob is
   not drop-in: the presigner is hand-rolled AWS SigV4
   (`apps/api/src/modules/chat/attachments/s3-presign.util.ts`), so Blob's
   SharedKey/SAS scheme needs a new driver. Options in
   `docs/deployment/production.md` §11.3.

## Teardown

```bash
az group delete -n raven-production --yes    # everything except the Key Vault's 7-day soft-delete
```
