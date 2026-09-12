#!/usr/bin/env bash
# Deploy / update the Livqeno API Container App.
#
# Renders a full app spec from Key Vault into a temp file (mode 600, deleted
# on exit), then applies it. YAML rather than flags because `az containerapp`
# joins repeated --args/--env-vars values with commas, which silently
# corrupts a container command — the migration job hit exactly that
# ("/bin/sh: illegal option -,").
#
# Idempotent. `activeRevisionsMode: Multiple` means each run creates a new
# revision and keeps the previous one for rollback (see README "Rollback").
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

export RAVEN_CAE="${RAVEN_CAE:-raven-env}"
APP="${RAVEN_API_APP:-raven-api}"
# Same tag source as 09-api-image.sh; see 00-variables.sh.
TAG="${RAVEN_IMAGE_TAG}"

ENVID="$(az containerapp env show -n "${RAVEN_CAE}" -g "${RAVEN_RG}" --query id -o tsv)"
DOMAIN="$(az containerapp env show -n "${RAVEN_CAE}" -g "${RAVEN_RG}" --query properties.defaultDomain -o tsv)"
FQDN="${APP}.${DOMAIN}"
LOGIN_SERVER="$(az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --query loginServer -o tsv)"
SFU_PRIVATE_IP="$(az vm show -g "${RAVEN_RG}" -n "${RAVEN_SFU_VM}" -d --query privateIps -o tsv)"
TURN_PRIVATE_IP="$(az vm show -g "${RAVEN_RG}" -n "${RAVEN_TURN_VM}" -d --query privateIps -o tsv)"
TURN_FQDN="$(az network public-ip show -g "${RAVEN_RG}" -n "${RAVEN_TURN_IP_NAME}" --query dnsSettings.fqdn -o tsv)"

kv() { az keyvault secret show --vault-name "${RAVEN_KV}" -n "$1" --query value -o tsv; }
kv_exists() { az keyvault secret show --vault-name "${RAVEN_KV}" -n "$1" --output none 2>/dev/null; }

# OAuth sign-in. Optional and independent per provider, same shape as
# STORAGE_* below: absent means the feature stays off (the dashboard's
# GitHub/Google buttons don't render — apps/dashboard/src/components/
# auth/oauth-buttons.tsx), not a boot failure. Populate via
# 05-secrets.sh's PROD_GITHUB_CLIENT_ID / PROD_GOOGLE_CLIENT_ID vars
# first; see docs/deployment/livqeno-domain-cutover.md §4 for why the
# operator's local-dev OAuth credentials cannot simply be reused here
# (they're registered against a localhost callback).
OAUTH_SECRETS_YAML=""
OAUTH_ENV_YAML=""
if kv_exists github-client-id; then
  OAUTH_SECRETS_YAML="${OAUTH_SECRETS_YAML}
      - name: github-client-id
        value: $(kv github-client-id)
      - name: github-client-secret
        value: $(kv github-client-secret)"
  OAUTH_ENV_YAML="${OAUTH_ENV_YAML}
          - name: GITHUB_CLIENT_ID
            secretRef: github-client-id
          - name: GITHUB_CLIENT_SECRET
            secretRef: github-client-secret"
fi
if kv_exists google-client-id; then
  OAUTH_SECRETS_YAML="${OAUTH_SECRETS_YAML}
      - name: google-client-id
        value: $(kv google-client-id)
      - name: google-client-secret
        value: $(kv google-client-secret)"
  OAUTH_ENV_YAML="${OAUTH_ENV_YAML}
          - name: GOOGLE_CLIENT_ID
            secretRef: google-client-id
          - name: GOOGLE_CLIENT_SECRET
            secretRef: google-client-secret"
fi

# The dashboard's own public URL, not this API's — GITHUB_CALLBACK_URL /
# GOOGLE_CALLBACK_URL derive from it (configuration.ts) unless overridden.
# No fallback invented: an unset APP_URL with OAuth configured would send
# providers back to http://localhost:3000, which is silently wrong rather
# than loudly broken, so this is set only when the operator supplies it.
if [ -n "${RAVEN_APP_URL:-}" ]; then
  APP_URL_ENV_YAML="
          - name: APP_URL
            value: ${RAVEN_APP_URL}"
elif [ -n "${OAUTH_ENV_YAML}" ]; then
  echo "!! OAuth secrets are in Key Vault but RAVEN_APP_URL is unset — callback URLs will fall back to http://localhost:3000. Set RAVEN_APP_URL and re-run." >&2
  APP_URL_ENV_YAML=""
else
  APP_URL_ENV_YAML=""
fi

# Origins allowed to call the API cross-origin. CORS_ORIGIN must not be "*"
# in production — the API refuses to boot (env.validation.ts).
#
# NOTE: the dashboard does NOT need to be listed for its own sake. It is a
# server-side BFF: the browser calls same-origin /api/* Next route handlers,
# which call this API from the Vercel server. CORS matters here for SDK
# consumers and for browser WebSocket origins. Set RAVEN_CORS_ORIGINS once
# the Vercel domains exist; until then this is the API's own origin, which
# is real (Swagger UI at /docs) and satisfies the check without inventing a
# domain that does not resolve.
CORS_ORIGINS="${RAVEN_CORS_ORIGINS:-https://${FQDN}}"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
SPEC="${WORK}/app.yaml"
umask 077

cat > "${SPEC}" <<YAML
location: ${RAVEN_LOCATION}
identity:
  type: SystemAssigned
properties:
  environmentId: ${ENVID}
  configuration:
    activeRevisionsMode: Multiple
    ingress:
      external: true
      targetPort: ${RAVEN_API_PORT:-4100}
      transport: auto
      allowInsecure: false
      traffic:
        - latestRevision: true
          weight: 100
    registries:
      # Managed identity, not an admin password. The app's system-assigned
      # identity holds AcrPull on the registry.
      - server: ${LOGIN_SERVER}
        identity: system
    secrets:
      - name: database-url
        value: $(kv database-url)
      - name: redis-url
        value: redis://:$(kv redis-password)@${SFU_PRIVATE_IP}:${RAVEN_REDIS_PORT}
      - name: jwt-secret
        value: $(kv jwt-secret)
      - name: rtc-token-secret
        value: $(kv rtc-token-secret)
      - name: chat-token-secret
        value: $(kv chat-token-secret)
      - name: api-key-hash-secret
        value: $(kv api-key-hash-secret)
      - name: sfu-registration-secret
        value: $(kv sfu-registration-secret)
      - name: turn-secret
        value: $(kv turn-secret)
      - name: metrics-scrape-secret
        value: $(kv metrics-scrape-secret)
      - name: egress-worker-shared-secret
        value: $(kv egress-worker-shared-secret)${OAUTH_SECRETS_YAML}
  template:
    containers:
      - image: ${LOGIN_SERVER}/raven-api:${TAG}
        name: ${APP}
        resources:
          cpu: 0.5
          memory: 1Gi
        env:
          - name: NODE_ENV
            value: production
          - name: API_PORT
            value: "${RAVEN_API_PORT:-4100}"
          - name: LOG_LEVEL
            value: info
          # Required in production (env.validation.ts) since 6d6c63c —
          # without it GET /metrics is public and unauthenticated.
          - name: METRICS_SCRAPE_SECRET
            secretRef: metrics-scrape-secret
          - name: API_PUBLIC_URL
            value: https://${FQDN}
          # Must be wss:// in production — RTC tokens travel on it.
          - name: RTC_SIGNALING_URL
            value: wss://${FQDN}/v1/rtc
          - name: CORS_ORIGIN
            value: ${CORS_ORIGINS}${APP_URL_ENV_YAML}${OAUTH_ENV_YAML}

          # --- Live Streaming broadcast redesign: the standalone
          # egress-worker Container App (17-egress-worker-app.sh), reached
          # over this Container Apps Environment's internal DNS — never
          # public. Both optional at the env-validation level, but every
          # BROADCAST-mode stream's start()/end() silently no-ops into
          # live_stream.egress_failed without them (see
          # EgressControlService). Run 17-egress-worker-app.sh before this
          # script if deploying both for the first time.
          - name: EGRESS_WORKER_BASE_URL
            value: http://${RAVEN_EGRESS_WORKER_APP}.internal.${DOMAIN}
          - name: EGRESS_WORKER_SHARED_SECRET
            secretRef: egress-worker-shared-secret

          # --- Supabase. DIRECT_URL is deliberately absent: the running app
          # never reads it, and only the migration job should hold a
          # session-mode connection.
          - name: DATABASE_URL
            secretRef: database-url
          # Per instance. instances x poolMax must stay under Supabase's
          # ceiling; 2 x 5 = 10 against the :6543 pooler.
          - name: DATABASE_POOL_MAX
            value: "5"

          # --- Redis on the SFU VM, reached over the VNet. Never public.
          - name: REDIS_URL
            secretRef: redis-url

          - name: JWT_SECRET
            secretRef: jwt-secret
          - name: JWT_EXPIRES_IN
            value: 12h
          - name: RTC_TOKEN_SECRET
            secretRef: rtc-token-secret
          - name: RTC_TOKEN_DEFAULT_TTL_SECONDS
            value: "600"
          - name: CHAT_TOKEN_SECRET
            secretRef: chat-token-secret
          - name: API_KEY_HASH_SECRET
            secretRef: api-key-hash-secret

          # --- SFU. The API has no SFU_URL and no SFU_PUBLIC_IP: nodes
          # self-register into the rtc_servers table with their own
          # internalUrl, and the API discovers them from there.
          # SFU_PUBLIC_IP is SFU-side config, set in 06-deploy-sfu.sh.
          - name: SFU_REGISTRATION_SECRET
            secretRef: sfu-registration-secret
          - name: SFU_HEARTBEAT_TIMEOUT_SECONDS
            value: "30"
          - name: SFU_DEFAULT_REGION
            value: ${RAVEN_LOCATION}

          # --- Required by the base validation schema, no defaults.
          - name: SIGNALING_MAX_PARTICIPANTS_PER_ROOM
            value: "50"
          - name: SIGNALING_MAX_MESSAGE_BYTES
            value: "16384"
          - name: SIGNALING_MAX_MESSAGES_PER_WINDOW
            value: "100"
          - name: SIGNALING_MESSAGE_WINDOW_SECONDS
            value: "10"
          - name: SIGNALING_MAX_CONNECTIONS_PER_WINDOW
            value: "20"

          # --- coturn. No control channel; the shared secret is the only
          # coupling. TURN_HOST is handed to clients, so it is the
          # certificated hostname. TURN_INTERNAL_HOST is private and used
          # only by this API's own STUN health probe.
          - name: TURN_SECRET
            secretRef: turn-secret
          - name: TURN_HOST
            value: ${TURN_FQDN}
          - name: TURN_INTERNAL_HOST
            value: ${TURN_PRIVATE_IP}
          - name: TURN_PORT
            value: "${RAVEN_TURN_PORT}"
          - name: TURN_TLS_PORT
            value: "${RAVEN_TURN_TLS_PORT}"

          # STORAGE_* intentionally unset: chat attachments stay disabled
          # (the API returns ATTACHMENTS_NOT_CONFIGURED) rather than
          # half-working. Azure Blob is not drop-in — the presigner is
          # hand-rolled AWS SigV4. See docs/deployment/production.md 11.3.
        probes:
          # Both probes hit /health/live, NOT /health/ready — deliberately.
          #
          # /health/ready is 503 until an SFU is registered, and an SFU
          # registers by calling this API through this ingress. Gating
          # ingress on it therefore deadlocks a cold start: no traffic ->
          # no registration -> never ready. /health/ready is unmodified and
          # remains the real dependency signal for monitoring and for the
          # verification suite; it is just not the ingress gate.
          - type: Liveness
            httpGet:
              path: /health/live
              port: ${RAVEN_API_PORT:-4100}
            initialDelaySeconds: 20
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 3
          - type: Readiness
            httpGet:
              path: /health/live
              port: ${RAVEN_API_PORT:-4100}
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
    scale:
      # Deliberately not aggressive. Every replica opens its own pg pool and
      # its own Redis connection; the webhook worker self-coordinates with a
      # Redis lock, so replica count is safe to raise, but the database
      # connection ceiling is the real limit.
      minReplicas: 1
      maxReplicas: 2
YAML

if az containerapp show -n "${APP}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "==> Updating ${APP} (new revision, previous kept)"
  az containerapp update -n "${APP}" -g "${RAVEN_RG}" --yaml "${SPEC}" --output none
else
  echo "==> Creating ${APP}"
  az containerapp create -n "${APP}" -g "${RAVEN_RG}" --yaml "${SPEC}" --output none
  # AcrPull for the freshly created identity. Without it the identity-based
  # pull fails and the first revision never activates.
  PRINCIPAL="$(az containerapp show -n "${APP}" -g "${RAVEN_RG}" --query identity.principalId -o tsv)"
  ACR_ID="$(az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --query id -o tsv)"
  az role assignment create --assignee-object-id "${PRINCIPAL}" \
    --assignee-principal-type ServicePrincipal --role AcrPull --scope "${ACR_ID}" --output none || true
fi

echo "==> Waiting for the latest revision"
for _ in $(seq 1 30); do
  STATE="$(az containerapp revision list -n "${APP}" -g "${RAVEN_RG}" \
    --query "reverse(sort_by([].{c:properties.createdTime,r:properties.runningState},&c))[0].r" -o tsv 2>/dev/null || true)"
  [ "${STATE}" = "Running" ] && break
  case "${STATE}" in Failed|ActivationFailed|Degraded) echo "    ${STATE}"; break ;; esac
  sleep 15
done
echo "    ${STATE}"

echo
echo "API:  https://${FQDN}"
echo "Set RAVEN_API_URL to that value in the Vercel dashboard project."
