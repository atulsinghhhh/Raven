# Raven on Azure — media plane (Phase 2)

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

## What Phase 2 does not include

The Raven API. It is Phase 3, and it goes to Container Apps — not to these
VMs. `snet-apps` is already reserved for it (see below).

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

`turn-secret` is the *entire* coupling between Raven and coturn. Raven mints
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
the relay, which then rejects every Raven-minted credential with a 401 while
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

Roughly **$62/month** on pay-as-you-go, against a $100 student credit — so
about six weeks. Revised up from an earlier $50 estimate because eastasia
has no 1-vCPU v2 size for coturn, and disks were not counted.

| Item | ~$/mo |
|---|---|
| `raven-sfu-01` B2als_v2 | 31 |
| `raven-coturn-01` B2ats_v2 | 15 |
| 2 × Standard static public IP | 7 |
| ACR Basic | 5 |
| 2 × 30 GB StandardSSD | 5 |
| Key Vault | ~0 |

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
