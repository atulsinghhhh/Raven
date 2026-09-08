# 02 — Credit burn outpaces the budget (~$95/mo against $100)

**Severity:** High · **Area:** Infra / cost

## What is wrong

The deployment runs on an **Azure for Students** subscription with a $100
credit and no payment method. Steady-state cost is roughly **$95/month**,
so the credit is exhausted in about five weeks. When it runs out Azure
stops and eventually **deletes** resources rather than billing.

Indicative monthly figures (verify against current rates):

| Item | ~$/mo |
|---|---|
| `raven-api` Container App (0.5 vCPU / 1 GiB, always-on) | 33 |
| `raven-sfu-01` `Standard_B2als_v2` | 31 |
| `raven-coturn-01` `Standard_B2ats_v2` | 15 |
| 2 × Standard static public IP | 7 |
| ACR Basic | 5 |
| 2 × 30 GB StandardSSD | 5 |
| Azure DNS zone | 0.50 |

Egress is extra and metered: 100 GB/month free, then ~$0.087/GB. The media
plane is an egress amplifier — a 4-participant SFU call is roughly 6.5 GB/hr
— so load testing can cost more than the compute. See
`docs/deployment/azure-student.md`.

## Why the obvious saving is a trap

`minReplicas: 0` on the Container App looks like the easy win. It is not: a
scaled-to-zero API stops answering SFU registration and heartbeats, the
fleet goes UNHEALTHY, and RTC breaks until something wakes it.

## Options

1. **Halve the API** to 0.25 vCPU / 0.5 GiB (~$17/mo instead of ~$33).
   Given the measured REST ceiling is bounded by bcrypt on the event loop
   (issue 03) rather than by CPU share, this may cost little real capacity.
2. **Deallocate the VMs between sessions** — compute stops billing, disks
   and IPs continue (~$12/mo floor). Static IPs survive, so
   `SFU_PUBLIC_IP` stays valid:
   ```bash
   az vm deallocate -g raven-production -n raven-sfu-01 --no-wait
   az vm deallocate -g raven-production -n raven-coturn-01 --no-wait
   ```
3. **Move the media plane off Azure.** Oracle Cloud Always Free (4 ARM
   cores, 24 GB, 10 TB egress) or Hetzner (~€4, 20 TB) removes both the VM
   cost and the egress risk. The SFU is Go and builds for arm64 cleanly.
   Analysis in `docs/deployment/azure-student.md`.
4. **Set a budget alert** so exhaustion is not a surprise.

## Also worth knowing

There is no reliable programmatic read of remaining student credit —
`az consumption usage list` returns null costs for this subscription type.
Track it in the portal.
