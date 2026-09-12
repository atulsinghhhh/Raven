#!/usr/bin/env bash
# Live Streaming broadcast redesign — HLS storage + CDN.
#
# Creates the Azure Storage Account + container the egress worker
# (services/egress-worker/src/storage/azure-blob-storage-driver.ts)
# uploads HLS segments/manifests to, and an Azure Front Door (Standard)
# profile in front of it so viewers never fetch the storage account's own
# URL directly.
#
# Deliberately a NEW storage account, not the one chat attachments would
# use (docs/issues/06-azure-blob-storage-driver.md — that gap is separate
# and unresolved; this script does not touch it). This account holds
# nothing but this container's HLS output.
#
# The container is public-read at the BLOB level (anonymous GET on a blob
# whose full path is known, not a listable container) — see
# AzureBlobStorageDriver's own doc comment for why that's the right default
# for a PUBLIC-visibility live stream today, and the explicitly-flagged
# follow-up for PRIVATE/AUTHENTICATED streams this pass does not yet
# differentiate.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "==> Storage account ${RAVEN_EGRESS_STORAGE_ACCOUNT}"
if az storage account show -n "${RAVEN_EGRESS_STORAGE_ACCOUNT}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "    already exists"
else
  az storage account create \
    --name "${RAVEN_EGRESS_STORAGE_ACCOUNT}" \
    --resource-group "${RAVEN_RG}" \
    --location "${RAVEN_LOCATION}" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --min-tls-version TLS1_2 \
    --allow-blob-public-access true \
    --output none
  echo "    created"
fi

CONNECTION_STRING="$(az storage account show-connection-string \
  -n "${RAVEN_EGRESS_STORAGE_ACCOUNT}" -g "${RAVEN_RG}" --query connectionString -o tsv)"

echo "==> Container ${RAVEN_EGRESS_CONTAINER}"
az storage container create \
  --name "${RAVEN_EGRESS_CONTAINER}" \
  --connection-string "${CONNECTION_STRING}" \
  --public-access blob \
  --output none
echo "    ensured (public-access: blob)"

echo "==> Storing connection string in Key Vault"
az keyvault secret set --vault-name "${RAVEN_KV}" -n egress-storage-connection-string \
  --value "${CONNECTION_STRING}" --output none
echo "    + egress-storage-connection-string"

# --- Azure Front Door (Standard), storage account as origin ---------------
#
# Best-effort, not required: Azure Front Door is categorically unavailable
# on "Free Trial and Student" subscriptions ("BadRequest: Free Trial and
# Student account is forbidden for Azure Frontdoor resources" — confirmed
# directly, not a guess), and both alternatives (classic Microsoft/Akamai
# CDN) no longer accept new profile creation at all, on any subscription
# tier. If Front Door genuinely can't be created here, this script falls
# back to the storage account's own public blob endpoint as the playback
# base URL — real, correct HTTPS, just without an edge cache in front of
# it — rather than failing the whole provisioning run over a CDN layer
# that may simply not be purchasable yet. Re-run this script after
# upgrading the subscription (or adding a different CDN, e.g. Cloudflare
# in front of this same storage account) to pick up Front Door instead.
BLOB_HOST="$(az storage account show -n "${RAVEN_EGRESS_STORAGE_ACCOUNT}" -g "${RAVEN_RG}" \
  --query "primaryEndpoints.blob" -o tsv | sed -E 's#https://##; s#/$##')"
FRONTDOOR_AVAILABLE=true

echo "==> Front Door profile ${RAVEN_EGRESS_FRONTDOOR_PROFILE}"
if az afd profile show -n "${RAVEN_EGRESS_FRONTDOOR_PROFILE}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "    already exists"
elif ! az afd profile create \
    --profile-name "${RAVEN_EGRESS_FRONTDOOR_PROFILE}" \
    --resource-group "${RAVEN_RG}" \
    --sku Standard_AzureFrontDoor \
    --output none 2>"${WORK}/afd-error.log"; then
  echo "    !! Front Door unavailable on this subscription — falling back to the direct blob endpoint:"
  sed 's/^/       /' "${WORK}/afd-error.log"
  FRONTDOOR_AVAILABLE=false
else
  echo "    created"
fi

if [ "${FRONTDOOR_AVAILABLE}" = true ]; then
  echo "==> Endpoint ${RAVEN_EGRESS_FRONTDOOR_ENDPOINT}"
  az afd endpoint create \
    --resource-group "${RAVEN_RG}" \
    --profile-name "${RAVEN_EGRESS_FRONTDOOR_PROFILE}" \
    --endpoint-name "${RAVEN_EGRESS_FRONTDOOR_ENDPOINT}" \
    --enabled-state Enabled \
    --output none 2>/dev/null || echo "    already exists"

  echo "==> Origin group ${RAVEN_EGRESS_FRONTDOOR_ORIGIN_GROUP}"
  az afd origin-group create \
    --resource-group "${RAVEN_RG}" \
    --profile-name "${RAVEN_EGRESS_FRONTDOOR_PROFILE}" \
    --origin-group-name "${RAVEN_EGRESS_FRONTDOOR_ORIGIN_GROUP}" \
    --probe-request-type GET \
    --probe-protocol Https \
    --probe-interval-in-seconds 60 \
    --probe-path "/${RAVEN_EGRESS_CONTAINER}/" \
    --sample-size 4 \
    --successful-samples-required 3 \
    --additional-latency-in-milliseconds 50 \
    --output none 2>/dev/null || echo "    already exists"

  echo "==> Origin (storage account blob endpoint)"
  az afd origin create \
    --resource-group "${RAVEN_RG}" \
    --profile-name "${RAVEN_EGRESS_FRONTDOOR_PROFILE}" \
    --origin-group-name "${RAVEN_EGRESS_FRONTDOOR_ORIGIN_GROUP}" \
    --origin-name "${RAVEN_EGRESS_STORAGE_ACCOUNT}" \
    --host-name "${BLOB_HOST}" \
    --origin-host-header "${BLOB_HOST}" \
    --http-port 80 \
    --https-port 443 \
    --priority 1 \
    --weight 1000 \
    --enabled-state Enabled \
    --output none 2>/dev/null || echo "    already exists"

  echo "==> Route (/${RAVEN_EGRESS_CONTAINER}/* -> origin group, HTTPS only, cache on)"
  az afd route create \
    --resource-group "${RAVEN_RG}" \
    --profile-name "${RAVEN_EGRESS_FRONTDOOR_PROFILE}" \
    --endpoint-name "${RAVEN_EGRESS_FRONTDOOR_ENDPOINT}" \
    --route-name "live-hls-route" \
    --origin-group "${RAVEN_EGRESS_FRONTDOOR_ORIGIN_GROUP}" \
    --supported-protocols Https \
    --patterns-to-match "/${RAVEN_EGRESS_CONTAINER}/*" \
    --forwarding-protocol HttpsOnly \
    --link-to-default-domain Enabled \
    --https-redirect Enabled \
    --output none 2>/dev/null || echo "    already exists"

  FD_HOSTNAME="$(az afd endpoint show \
    --resource-group "${RAVEN_RG}" \
    --profile-name "${RAVEN_EGRESS_FRONTDOOR_PROFILE}" \
    --endpoint-name "${RAVEN_EGRESS_FRONTDOOR_ENDPOINT}" \
    --query hostName -o tsv)"

  CDN_BASE_URL="https://${FD_HOSTNAME}/${RAVEN_EGRESS_CONTAINER}"
else
  # No CDN available on this subscription — the storage account's own
  # public blob endpoint is a real, correct, HTTPS URL and works today;
  # it just has no edge cache in front of it. See the comment above.
  CDN_BASE_URL="https://${BLOB_HOST}/${RAVEN_EGRESS_CONTAINER}"
fi

echo "==> Storing the public CDN base URL in Key Vault"
az keyvault secret set --vault-name "${RAVEN_KV}" -n egress-cdn-base-url \
  --value "${CDN_BASE_URL}" --output none
echo "    + egress-cdn-base-url = ${CDN_BASE_URL}"

echo
echo "Public playback base URL: ${CDN_BASE_URL}"
echo "(A stream's manifest is at \${CDN_BASE_URL}/<streamId>/index.m3u8 —"
echo " this is exactly what GET /v1/live-streams/:id/playback returns.)"
