#!/usr/bin/env bash
# Container Apps environment, VNet-integrated into snet-apps.
#
# VNet integration is REQUIRED here, not a nicety: Redis runs on the SFU VM
# rather than in Azure Cache, and the SFU's control port is private. Without
# the environment inside the VNet the API could only reach them over the
# public Internet, which would mean exposing Redis — explicitly forbidden.
#
# An environment cannot be moved into a VNet after creation. Getting this
# wrong means deleting and rebuilding it.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

export RAVEN_CAE="${RAVEN_CAE:-raven-env}"

if az containerapp env show -n "${RAVEN_CAE}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "==> ${RAVEN_CAE} already exists, skipping"
else
  SUBNET_ID="$(az network vnet subnet show -g "${RAVEN_RG}" --vnet-name "${RAVEN_VNET}" \
    -n "${RAVEN_SUBNET_APPS}" --query id -o tsv)"
  echo "==> Creating ${RAVEN_CAE} in ${RAVEN_LOCATION} (this takes several minutes)"
  # Consumption-only. No workload profiles: they add cost and this MVP has
  # one small always-on app.
  az containerapp env create \
    --name "${RAVEN_CAE}" \
    --resource-group "${RAVEN_RG}" \
    --location "${RAVEN_LOCATION}" \
    --infrastructure-subnet-resource-id "${SUBNET_ID}" \
    --logs-destination azure-monitor \
    --output none
  echo "    created"
fi

az containerapp env show -n "${RAVEN_CAE}" -g "${RAVEN_RG}" \
  --query "{name:name, location:location, state:properties.provisioningState, staticIp:properties.staticIp, subnet:properties.vnetConfiguration.infrastructureSubnetId}" -o yaml
