#!/usr/bin/env bash
# VNet, subnets, static public IPs, and NSGs. Idempotent.
#
# Every rule below exists because something in this repository requires it.
# Nothing is opened "just in case" — the media plane's whole security model
# is that only the media range and the TURN ports face the Internet, and
# control ports do not.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

# The address SSH is permitted from. Defaults to wherever you are now;
# override when it changes (`RAVEN_ADMIN_CIDR=1.2.3.4/32 ./02-network.sh`).
ADMIN_CIDR="${RAVEN_ADMIN_CIDR:-$(curl -fsS https://api.ipify.org)/32}"
echo "==> SSH will be restricted to ${ADMIN_CIDR}"

echo "==> VNet ${RAVEN_VNET} (${RAVEN_VNET_CIDR})"
az network vnet create \
  --resource-group "${RAVEN_RG}" --name "${RAVEN_VNET}" \
  --location "${RAVEN_LOCATION}" --address-prefixes "${RAVEN_VNET_CIDR}" \
  --subnet-name "${RAVEN_SUBNET_MEDIA}" --subnet-prefixes "${RAVEN_SUBNET_MEDIA_CIDR}" \
  --output none
echo "    ${RAVEN_SUBNET_MEDIA} = ${RAVEN_SUBNET_MEDIA_CIDR} (SFU + coturn VMs)"

# Reserved now, delegated in Phase 3. A Container Apps environment cannot
# be moved into a VNet after creation, and it needs its own subnet — so the
# space is claimed here even though nothing uses it yet.
az network vnet subnet create \
  --resource-group "${RAVEN_RG}" --vnet-name "${RAVEN_VNET}" \
  --name "${RAVEN_SUBNET_APPS}" --address-prefixes "${RAVEN_SUBNET_APPS_CIDR}" \
  --output none 2>/dev/null || echo "    ${RAVEN_SUBNET_APPS} already exists"
echo "    ${RAVEN_SUBNET_APPS} = ${RAVEN_SUBNET_APPS_CIDR} (reserved: Phase 3 Container Apps)"

# Static, not dynamic. SFU_PUBLIC_IP goes into every ICE candidate the node
# advertises; an address that changes on VM restart would break every call
# placed after it and silently push clients onto TURN.
for ip in "${RAVEN_SFU_IP_NAME}" "${RAVEN_TURN_IP_NAME}"; do
  echo "==> Static public IP ${ip}"
  az network public-ip create \
    --resource-group "${RAVEN_RG}" --name "${ip}" \
    --location "${RAVEN_LOCATION}" --sku Standard --allocation-method Static \
    --output none
done

# ---------------------------------------------------------------------------
# SFU NSG
# ---------------------------------------------------------------------------
echo "==> NSG ${RAVEN_SFU_NSG}"
az network nsg create -g "${RAVEN_RG}" -n "${RAVEN_SFU_NSG}" -l "${RAVEN_LOCATION}" --output none

# Media. The one range that must face the Internet, and must be published
# 1:1 — ICE advertises the exact port the SFU bound, so any remapping hands
# clients addresses that do not exist (docs/rtc/networking.md).
az network nsg rule create -g "${RAVEN_RG}" --nsg-name "${RAVEN_SFU_NSG}" \
  -n AllowSfuMediaUdp --priority 100 --direction Inbound --access Allow \
  --protocol Udp --source-address-prefixes Internet \
  --destination-port-ranges "${RAVEN_SFU_UDP_MIN}-${RAVEN_SFU_UDP_MAX}" \
  --description "SRTP media. Clients connect directly; never via an ingress." \
  --output none

# Control plane only: node link (/internal/link), /healthz, /readyz,
# /metrics. Scoped to the Container Apps subnet — the API is the only thing
# that may talk to it. Media never crosses this port.
az network nsg rule create -g "${RAVEN_RG}" --nsg-name "${RAVEN_SFU_NSG}" \
  -n AllowSfuControlFromApps --priority 110 --direction Inbound --access Allow \
  --protocol Tcp --source-address-prefixes "${RAVEN_SUBNET_APPS_CIDR}" \
  --destination-port-ranges "${RAVEN_SFU_HTTP_PORT}" \
  --description "SFU node link + health/metrics. API only, never Internet." \
  --output none

# Redis runs as a container on this VM. Reachable from the Container Apps
# subnet and nothing else — it holds presence, rate-limit counters and chat
# fan-out, and is never a public service.
az network nsg rule create -g "${RAVEN_RG}" --nsg-name "${RAVEN_SFU_NSG}" \
  -n AllowRedisFromApps --priority 120 --direction Inbound --access Allow \
  --protocol Tcp --source-address-prefixes "${RAVEN_SUBNET_APPS_CIDR}" \
  --destination-port-ranges "${RAVEN_REDIS_PORT}" \
  --description "Redis. Private subnet only." \
  --output none

az network nsg rule create -g "${RAVEN_RG}" --nsg-name "${RAVEN_SFU_NSG}" \
  -n AllowSshFromAdmin --priority 300 --direction Inbound --access Allow \
  --protocol Tcp --source-address-prefixes "${ADMIN_CIDR}" \
  --destination-port-ranges 22 \
  --description "Operator SSH from a single address." \
  --output none

# ---------------------------------------------------------------------------
# coturn NSG
# ---------------------------------------------------------------------------
echo "==> NSG ${RAVEN_TURN_NSG}"
az network nsg create -g "${RAVEN_RG}" -n "${RAVEN_TURN_NSG}" -l "${RAVEN_LOCATION}" --output none

# STUN and TURN control. UDP is the normal path; TCP is the fallback for
# networks that block UDP outright.
az network nsg rule create -g "${RAVEN_RG}" --nsg-name "${RAVEN_TURN_NSG}" \
  -n AllowTurnUdp --priority 100 --direction Inbound --access Allow \
  --protocol Udp --source-address-prefixes Internet \
  --destination-port-ranges "${RAVEN_TURN_PORT}" \
  --description "STUN binding + TURN allocate, UDP." --output none

az network nsg rule create -g "${RAVEN_RG}" --nsg-name "${RAVEN_TURN_NSG}" \
  -n AllowTurnTcp --priority 110 --direction Inbound --access Allow \
  --protocol Tcp --source-address-prefixes Internet \
  --destination-port-ranges "${RAVEN_TURN_PORT}" \
  --description "TURN over TCP — the fallback when UDP is blocked." --output none

# Relay range. coturn allocates a relay address from here per allocation;
# the peer side sends to it, so it has to be reachable. Matches
# turnserver.conf's min-port/max-port and what docker-compose.yml publishes.
az network nsg rule create -g "${RAVEN_RG}" --nsg-name "${RAVEN_TURN_NSG}" \
  -n AllowTurnRelayUdp --priority 120 --direction Inbound --access Allow \
  --protocol Udp --source-address-prefixes Internet \
  --destination-port-ranges "${RAVEN_TURN_RELAY_MIN}-${RAVEN_TURN_RELAY_MAX}" \
  --description "Relayed media. Matches turnserver.conf min-port/max-port." --output none

az network nsg rule create -g "${RAVEN_RG}" --nsg-name "${RAVEN_TURN_NSG}" \
  -n AllowSshFromAdmin --priority 300 --direction Inbound --access Allow \
  --protocol Tcp --source-address-prefixes "${ADMIN_CIDR}" \
  --destination-port-ranges 22 \
  --description "Operator SSH from a single address." --output none

# DELIBERATELY NOT CREATED:
#
#   TURNS 5349 (TCP+UDP) — TURN over TLS/DTLS. Opening it without a valid
#   certificate for the production hostname would advertise a listener that
#   fails the handshake, which is worse than not advertising it: the client
#   wastes an ICE candidate on it. The repo's certs/ holds a self-signed dev
#   pair only. Add this rule at the same time as the real cert.
#
#   9641 — coturn's Prometheus endpoint. Never Internet-facing.
#
#   Anything else. Azure's default inbound deny handles the rest; no
#   explicit deny rule is needed and adding one would only obscure that.

echo "==> Done. Rules:"
for nsg in "${RAVEN_SFU_NSG}" "${RAVEN_TURN_NSG}"; do
  echo "--- ${nsg}"
  az network nsg rule list -g "${RAVEN_RG}" --nsg-name "${nsg}" \
    --query "sort_by([].{p:priority, name:name, proto:protocol, src:sourceAddressPrefix, ports:destinationPortRange}, &p)" -o table
done
