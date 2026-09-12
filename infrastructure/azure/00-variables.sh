#!/usr/bin/env bash
# Livqeno on Azure — shared configuration.
#
# Sourced by every other script here. Contains NO secrets: only names,
# sizes, regions and port numbers. Secrets live in Key Vault (05-secrets.sh)
# and are never written to this file or to git.
#
# Region: eastasia (Hong Kong).
#
# The intent was to sit next to the Supabase project in ap-southeast-1, so
# the API<->Postgres round trip stays short — that path is on every
# authenticated request (see docs/production/capacity-report.md §1).
# southeastasia would have been the match, but this subscription carries the
# Azure for Students policy "Allowed resource deployment regions", which
# permits only: indiasouthcentral, koreacentral, uaenorth, eastasia,
# centralindia. eastasia is the closest of those to Singapore.
#
#   az policy assignment list --query "[0].parameters"
#
# Changing region means rebuilding every resource below — none of them can
# be moved in place.
set -euo pipefail

export RAVEN_SUBSCRIPTION="${RAVEN_SUBSCRIPTION:-$(az account show --query id -o tsv)}"
export RAVEN_LOCATION="eastasia"
export RAVEN_RG="raven-production"

# ACR names are globally unique and allow only lowercase alphanumerics.
export RAVEN_ACR="${RAVEN_ACR:-ravenacr}"

# --- Network -----------------------------------------------------------
# One /16, carved so the Container Apps subnet (Phase 3) is reserved up
# front. A VNet-integrated Container Apps environment needs a dedicated
# subnet delegated to Microsoft.App/environments, minimum /23 — and moving
# an environment into a VNet afterwards is not possible, it has to be
# rebuilt. Allocating it now costs nothing.
export RAVEN_VNET="raven-vnet"
export RAVEN_VNET_CIDR="10.10.0.0/16"
export RAVEN_SUBNET_MEDIA="snet-media"          # SFU + coturn VMs
export RAVEN_SUBNET_MEDIA_CIDR="10.10.1.0/24"
export RAVEN_SUBNET_APPS="snet-apps"            # Phase 3: Container Apps
export RAVEN_SUBNET_APPS_CIDR="10.10.4.0/23"

# --- SFU VM ------------------------------------------------------------
# B2als_v2: 2 vCPU / 4 GB (AMD). The 4 GB matters because this host also
# runs the Redis container (Redis is load-bearing for presence, rate limits
# and chat fan-out, not a cache).
#
# Not Standard_B2s: eastasia has NO legacy Bs-family capacity at all —
# `az vm create` fails preflight with SkuNotAvailable "Capacity
# Restrictions". Only *_v2 sizes exist there. Verified with:
#   az vm list-skus -l eastasia --resource-type virtualMachines \
#     --query "[?starts_with(name,'Standard_B')].{n:name,r:length(restrictions)}"
# Basv2 (AMD) quota is 10 vCPUs; Total Regional is 6. Both VMs = 4.
export RAVEN_SFU_VM="raven-sfu-01"
export RAVEN_SFU_SIZE="Standard_B2als_v2"
export RAVEN_SFU_IP_NAME="raven-sfu-ip"
export RAVEN_SFU_NSG="raven-sfu-nsg"

# --- coturn VM ---------------------------------------------------------
# B2ats_v2: 2 vCPU / 1 GB (AMD), the smallest size available in eastasia.
# coturn relays packets — it is network-bound, not CPU- or memory-bound, so
# 1 GB is ample. 2 vCPUs is not a choice: no 1-vCPU v2 size exists, and the
# legacy 1-vCPU B1s has no capacity in this region.
export RAVEN_TURN_VM="raven-coturn-01"
export RAVEN_TURN_SIZE="Standard_B2ats_v2"
export RAVEN_TURN_IP_NAME="raven-coturn-ip"
export RAVEN_TURN_NSG="raven-coturn-nsg"

# --- Ports -------------------------------------------------------------
# Every value below is read from the repository, not chosen here. Changing
# one means changing it in .env / docker-compose.yml too.
#
# SFU media: services/sfu/internal/config/config.go defaults
# SFU_UDP_PORT_MIN/MAX to 51000-51200. The range MUST be published 1:1 —
# ICE advertises the exact port the SFU bound, so a remapped range hands
# clients addresses that do not exist (docs/rtc/networking.md).
export RAVEN_SFU_UDP_MIN="51000"
export RAVEN_SFU_UDP_MAX="51200"
# SFU control: node link, /healthz, /readyz, /metrics. Internal only —
# media never crosses it.
export RAVEN_SFU_HTTP_PORT="7000"

# coturn: infrastructure/docker/coturn/turnserver.conf
export RAVEN_TURN_PORT="3478"        # STUN/TURN control, UDP + TCP
export RAVEN_TURN_TLS_PORT="5349"    # TURNS — NOT opened yet, no cert
export RAVEN_TURN_RELAY_MIN="49160"  # min-port
export RAVEN_TURN_RELAY_MAX="49200"  # max-port
export RAVEN_TURN_METRICS_PORT="9641" # --prometheus-port, never public

# Redis on the SFU VM, private subnet only.
export RAVEN_REDIS_PORT="6379"

export RAVEN_SSH_KEY="${HOME}/.ssh/raven-azure"
export RAVEN_ADMIN_USER="ravenadmin"

# Key Vault names are globally unique across Azure.
export RAVEN_KV="${RAVEN_KV:-raven-kv-ea1}"

# --- Image tag ---------------------------------------------------------
# The one tag both 04-images.sh (build/push) and 06-deploy-sfu.sh (pull)
# read. It lives here because it used to be defaulted independently in each
# script — 04 defaulted to the short commit SHA, 06 defaulted to `latest` —
# so a build and the deploy that followed it could disagree about which
# image was being shipped, and a pull of a tag that was never pushed
# reports "authentication required" rather than anything about a missing
# tag.
#
# Default `latest` matches what is deployed today. Set it explicitly to
# ship and run a specific build:
#
#   RAVEN_IMAGE_TAG=dtls-role-fix ./infrastructure/azure/04-images.sh
#   RAVEN_IMAGE_TAG=dtls-role-fix ./infrastructure/azure/06-deploy-sfu.sh
#
# 04-images.sh also pushes the immutable short-SHA tag on every build, so
# provenance survives regardless of what this is set to.
export RAVEN_IMAGE_TAG="${RAVEN_IMAGE_TAG:-latest}"

# Container Apps environment + API app.
export RAVEN_CAE="${RAVEN_CAE:-raven-env}"
export RAVEN_API_APP="${RAVEN_API_APP:-raven-api}"
# The port apps/api listens on: configuration.ts reads API_PORT (default
# 4000); the repo standardises on 4100 and Container Apps targetPort matches.
export RAVEN_API_PORT="${RAVEN_API_PORT:-4100}"
export RAVEN_MIGRATE_JOB="${RAVEN_MIGRATE_JOB:-raven-migrate}"

# --- Live Streaming broadcast redesign: egress worker + HLS storage/CDN ---
# Storage account names are globally unique, lowercase alphanumeric only,
# 3-24 chars — hence no "raven-" hyphen.
export RAVEN_EGRESS_STORAGE_ACCOUNT="${RAVEN_EGRESS_STORAGE_ACCOUNT:-ravenlivehls}"
export RAVEN_EGRESS_CONTAINER="${RAVEN_EGRESS_CONTAINER:-live-hls}"
# Azure Front Door (Standard) profile/endpoint in front of that container —
# never expose the storage account's own URL as the public playback URL.
export RAVEN_EGRESS_FRONTDOOR_PROFILE="${RAVEN_EGRESS_FRONTDOOR_PROFILE:-raven-live-fd}"
export RAVEN_EGRESS_FRONTDOOR_ENDPOINT="${RAVEN_EGRESS_FRONTDOOR_ENDPOINT:-raven-live}"
export RAVEN_EGRESS_FRONTDOOR_ORIGIN_GROUP="${RAVEN_EGRESS_FRONTDOOR_ORIGIN_GROUP:-live-hls-origin}"
export RAVEN_EGRESS_WORKER_APP="${RAVEN_EGRESS_WORKER_APP:-raven-egress-worker}"
# services/egress-worker/src/config.ts reads PORT (default 8600).
export RAVEN_EGRESS_WORKER_PORT="${RAVEN_EGRESS_WORKER_PORT:-8600}"
