#!/usr/bin/env bash
# Cut Raven over to ravenstack.online.
#
# RUN THIS ONLY AFTER the registrar's nameservers point at the Azure DNS
# zone (infrastructure/azure/README.md "Custom domains"). The script refuses
# to start otherwise, because every step below depends on the new hostnames
# resolving from the public internet:
#
#   - Azure validates a custom domain by looking up asuid.<host> TXT and the
#     CNAME. No DNS, no binding, no managed certificate.
#   - Let's Encrypt's HTTP-01 challenge for turn.<domain> hits port 80 on
#     the coturn VM by name. No DNS, no certificate.
#   - Switching TURN_HOST before turn.<domain> resolves would hand every RTC
#     client an ICE server it cannot look up, breaking relay for real users.
#
# Idempotent. The Azure-generated FQDN keeps working throughout — it is never
# removed, so this is a widening, not a migration cliff.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

DOMAIN="${RAVEN_DOMAIN:-ravenstack.online}"
API_HOST="api.${DOMAIN}"
TURN_HOST_NEW="turn.${DOMAIN}"
LANDING="https://${DOMAIN}"
DASH="https://app.${DOMAIN}"
DOCS="https://docs.${DOMAIN}"
ACME_EMAIL="${RAVEN_ACME_EMAIL:-}"
APP="${RAVEN_API_APP:-raven-api}"

SSH_OPTS=(-i "${RAVEN_SSH_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
TURN_PUBLIC_IP="$(az network public-ip show -g "${RAVEN_RG}" -n "${RAVEN_TURN_IP_NAME}" --query ipAddress -o tsv)"
TURN_PRIVATE_IP="$(az vm show -g "${RAVEN_RG}" -n "${RAVEN_TURN_VM}" -d --query privateIps -o tsv)"
APP_FQDN="$(az containerapp show -n "${APP}" -g "${RAVEN_RG}" --query properties.configuration.ingress.fqdn -o tsv)"

# ---------------------------------------------------------------------------
# 0. Gate on public DNS
# ---------------------------------------------------------------------------
echo "==> Checking public DNS for ${DOMAIN}"
fail=0
# Query a public resolver, not the system one. The local resolver may still
# hold the pre-cutover apex record until its TTL expires, which makes a
# perfectly propagated domain look unpropagated — that is a property of this
# machine, not of the domain, and Azure/Let's Encrypt will not see it.
RESOLVER="${RAVEN_DNS_RESOLVER:-1.1.1.1}"
check() { # check <host> <type> <expected-substring>
  local got; got="$(dig +short "$2" "$1" "@${RESOLVER}" 2>/dev/null | tr -d '\n')"
  if printf '%s' "${got}" | grep -q "$3"; then
    echo "    ok   $1 ($2) -> ${got}"
  else
    echo "    MISS $1 ($2) -> '${got}' (expected to contain '$3')"; fail=1
  fi
}
check "${DOMAIN}"            A     "76.76.21.21"
check "app.${DOMAIN}"        CNAME "vercel-dns"
check "docs.${DOMAIN}"       CNAME "vercel-dns"
check "${API_HOST}"          CNAME "azurecontainerapps.io"
check "asuid.${API_HOST}"    TXT   "$(az containerapp show -n "${APP}" -g "${RAVEN_RG}" --query properties.customDomainVerificationId -o tsv)"
check "${TURN_HOST_NEW}"     A     "${TURN_PUBLIC_IP}"
if [ "${fail}" -ne 0 ]; then
  echo
  echo "DNS is not in place yet. Point the registrar's nameservers at the"
  echo "Azure DNS zone and wait for propagation, then re-run:"
  az network dns zone show -g "${RAVEN_RG}" -n "${DOMAIN}" --query nameServers -o tsv | sed 's/^/    /'
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Bind api.<domain> to the Container App with an Azure-managed certificate
# ---------------------------------------------------------------------------
echo "==> Binding ${API_HOST} to ${APP}"
if az containerapp hostname list -n "${APP}" -g "${RAVEN_RG}" --query "[?name=='${API_HOST}']" -o tsv | grep -q .; then
  echo "    already bound"
else
  # A managed certificate is free and auto-renewing; a self-signed or
  # hand-managed cert on a public API would be strictly worse.
  az containerapp hostname add -n "${APP}" -g "${RAVEN_RG}" --hostname "${API_HOST}" --output none
  az containerapp hostname bind -n "${APP}" -g "${RAVEN_RG}" --hostname "${API_HOST}" \
    --environment "${RAVEN_CAE}" --validation-method CNAME --output none
  echo "    bound with a managed certificate"
fi

# ---------------------------------------------------------------------------
# 2. Real certificate for turn.<domain>
# ---------------------------------------------------------------------------
echo "==> Issuing a certificate for ${TURN_HOST_NEW}"
ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${TURN_PUBLIC_IP}" "
  set -e
  if sudo test -d /etc/letsencrypt/live/${TURN_HOST_NEW}; then
    echo '    certificate already present'
  else
    sudo certbot certonly --standalone --non-interactive --agree-tos \
      ${ACME_EMAIL:+--email ${ACME_EMAIL}} ${ACME_EMAIL:---register-unsafely-without-email} \
      -d ${TURN_HOST_NEW}
  fi
  # coturn runs as nobody:nogroup (65534) and cannot read letsencrypt's
  # root-owned key. Same staging + renewal hook as 11-turn-tls.sh.
  sudo mkdir -p /opt/raven/certs
  sudo install -o 65534 -g 65534 -m 644 /etc/letsencrypt/live/${TURN_HOST_NEW}/fullchain.pem /opt/raven/certs/fullchain.pem
  sudo install -o 65534 -g 65534 -m 600 /etc/letsencrypt/live/${TURN_HOST_NEW}/privkey.pem   /opt/raven/certs/privkey.pem
"

echo "==> Rewriting turnserver.conf for the new realm"
TURN_SECRET="$(az keyvault secret show --vault-name "${RAVEN_KV}" -n turn-secret --query value -o tsv)"
CONF=$(cat <<CONFIG
# Raven coturn — generated by infrastructure/azure/14-custom-domains.sh.
listening-port=${RAVEN_TURN_PORT}
tls-listening-port=${RAVEN_TURN_TLS_PORT}
min-port=${RAVEN_TURN_RELAY_MIN}
max-port=${RAVEN_TURN_RELAY_MAX}
external-ip=${TURN_PUBLIC_IP}/${TURN_PRIVATE_IP}
cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${TURN_HOST_NEW}
fingerprint
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
allowed-peer-ip=10.10.1.0-10.10.1.255
user-quota=${RAVEN_TURN_USER_QUOTA:-10}
total-quota=${RAVEN_TURN_TOTAL_QUOTA:-400}
max-bps=${RAVEN_TURN_MAX_BPS:-1000000}
simple-log
log-file=stdout
no-cli
CONFIG
)
# 600 and owned by 65534: coturn does NOT fail on an unreadable config, it
# runs with no realm and NO AUTH — an open relay. Asserted below.
printf '%s\n' "${CONF}" | ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${TURN_PUBLIC_IP}" \
  "umask 077 && cat > /tmp/turnserver.conf && sudo install -o 65534 -g 65534 -m 600 /tmp/turnserver.conf /opt/raven/turnserver.conf && rm -f /tmp/turnserver.conf"
ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${TURN_PUBLIC_IP}" \
  "cd /opt/raven && docker compose up -d --force-recreate && sleep 6"

if ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${TURN_PUBLIC_IP}" \
     "docker logs raven-coturn 2>&1 | grep -q 'Default realm: ${TURN_HOST_NEW}'"; then
  echo "    realm ${TURN_HOST_NEW} loaded"
else
  echo "    FAIL: config not loaded — coturn may be an open relay. Stopping it."
  ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${TURN_PUBLIC_IP}" "cd /opt/raven && docker compose stop"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Point the API at the new hostnames
# ---------------------------------------------------------------------------
# TURN_HOST is what goes into every client's iceServers (stun:/turn:/turns:),
# built by rtc-tokens/turn-credential.util.ts. TURN_INTERNAL_HOST stays the
# private 10.10.1.x address — it is only the API's own STUN health probe and
# must not travel over the internet.
echo "==> Updating ${APP} environment"
az containerapp update -n "${APP}" -g "${RAVEN_RG}" \
  --set-env-vars \
    "API_PUBLIC_URL=https://${API_HOST}" \
    "RTC_SIGNALING_URL=wss://${API_HOST}/v1/rtc" \
    "CORS_ORIGIN=${LANDING},${DASH},${DOCS}" \
    "TURN_HOST=${TURN_HOST_NEW}" \
  --output none
echo "    API_PUBLIC_URL, RTC_SIGNALING_URL, CORS_ORIGIN, TURN_HOST updated"

echo "==> Waiting for the new revision"
for _ in $(seq 1 30); do
  STATE="$(az containerapp revision list -n "${APP}" -g "${RAVEN_RG}" \
    --query "reverse(sort_by([].{c:properties.createdTime,r:properties.runningState},&c))[0].r" -o tsv 2>/dev/null || true)"
  [ "${STATE}" = "Running" ] && break
  case "${STATE}" in Failed|ActivationFailed|Degraded) break ;; esac
  sleep 15
done
echo "    ${STATE}"

# ---------------------------------------------------------------------------
# 4. Point the dashboard's BFF at the new API hostname
# ---------------------------------------------------------------------------
# Server-only, never NEXT_PUBLIC_. The browser keeps talking to the
# dashboard's own same-origin /api/* routes and never learns the API host.
echo "==> Updating Vercel RAVEN_API_URL and redeploying the dashboard"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
(
  cd "${REPO_ROOT}"
  vercel link --project raven-dashboard --yes >/dev/null 2>&1
  vercel env rm RAVEN_API_URL production --yes >/dev/null 2>&1 || true
  printf 'https://%s' "${API_HOST}" | vercel env add RAVEN_API_URL production >/dev/null 2>&1
  vercel deploy --prod --yes | tail -3
)

echo
echo "Done. Verify with:"
echo "  ./tests/verify-domains.sh ${DOMAIN}"
