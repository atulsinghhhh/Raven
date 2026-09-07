#!/usr/bin/env bash
# Resource group + container registry. Idempotent: safe to re-run.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

echo "==> Resource group ${RAVEN_RG} in ${RAVEN_LOCATION}"
az group create \
  --name "${RAVEN_RG}" \
  --location "${RAVEN_LOCATION}" \
  --tags project=raven managed-by=infrastructure/azure \
  --output none
echo "    ok"

# Basic tier: 10 GiB, no geo-replication, no private link. Enough for two
# images (raven-api, raven-sfu) and the cheapest SKU that exists.
echo "==> Container registry ${RAVEN_ACR} (Basic)"
if az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "    already exists, skipping"
else
  az acr create \
    --name "${RAVEN_ACR}" \
    --resource-group "${RAVEN_RG}" \
    --sku Basic \
    --location "${RAVEN_LOCATION}" \
    --output none
  echo "    created"
fi

# Admin user is how the VMs authenticate to pull. Managed identity would be
# better and is the Phase 3 path for Container Apps (AcrPull role), but a VM
# pulling with a token needs either this or an identity + assignment; admin
# user keeps the VM bootstrap to one `docker login`.
az acr update -n "${RAVEN_ACR}" --admin-enabled true --output none
echo "    admin user enabled (credentials go to Key Vault, never to git)"

az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" \
  --query "{name:name, loginServer:loginServer, sku:sku.name, location:location}" -o table
