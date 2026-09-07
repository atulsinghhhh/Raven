#!/usr/bin/env bash
# The two media-plane VMs. Idempotent: skips a VM that already exists.
#
# Why VMs and not Container Apps: both processes need large contiguous UDP
# port ranges published 1:1, and Container Apps / App Service expose
# HTTP(S)+WebSocket ingress only. This is not a preference, it is the only
# Azure compute form that can carry the traffic (docs/rtc/networking.md).
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

CLOUD_INIT="$(dirname "$0")/cloud-init-docker.yaml"

create_vm() {
  local name="$1" size="$2" ip_name="$3" nsg="$4"
  if az vm show -g "${RAVEN_RG}" -n "${name}" --output none 2>/dev/null; then
    echo "==> ${name} already exists, skipping"
    return
  fi
  echo "==> Creating ${name} (${size})"
  az vm create \
    --resource-group "${RAVEN_RG}" \
    --name "${name}" \
    --location "${RAVEN_LOCATION}" \
    --size "${size}" \
    --image Ubuntu2404 \
    --admin-username "${RAVEN_ADMIN_USER}" \
    --ssh-key-values "${RAVEN_SSH_KEY}.pub" \
    --vnet-name "${RAVEN_VNET}" \
    --subnet "${RAVEN_SUBNET_MEDIA}" \
    --public-ip-address "${ip_name}" \
    --nsg "${nsg}" \
    --custom-data "${CLOUD_INIT}" \
    --os-disk-size-gb 30 \
    --storage-sku StandardSSD_LRS \
    --output none
  # Passing an existing NSG name attaches it rather than generating a
  # default one, which would allow SSH from the whole Internet.
  echo "    created with NSG ${nsg}"
}

create_vm "${RAVEN_SFU_VM}"  "${RAVEN_SFU_SIZE}"  "${RAVEN_SFU_IP_NAME}"  "${RAVEN_SFU_NSG}"
create_vm "${RAVEN_TURN_VM}" "${RAVEN_TURN_SIZE}" "${RAVEN_TURN_IP_NAME}" "${RAVEN_TURN_NSG}"

echo "==> VMs"
az vm list -g "${RAVEN_RG}" -d \
  --query "[].{name:name, size:hardwareProfile.vmSize, publicIp:publicIps, privateIp:privateIps, state:powerState}" -o table
