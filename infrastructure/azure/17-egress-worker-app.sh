#!/usr/bin/env bash
# Deploy / update the egress-worker Container App.
#
# Internal ingress only — this app is called exclusively by the API's own
# EgressControlService (apps/api/src/modules/live-streams/egress/), never
# directly by a developer or a browser. It reaches the API's own *public*
# signaling endpoint itself (wss://<api-fqdn>/v1/rtc) to join a stream
# headlessly, exactly the same way any real viewer would — that's an
# outbound call needing no special network config.
#
# Same idempotent create-or-update + YAML-spec pattern as 13-api-app.sh;
# see that script's own header for why YAML rather than repeated --env-vars
# flags.
#
# Resources are higher than the API's own (0.5 CPU / 1Gi): each concurrent
# BROADCAST-mode stream's egress session holds one headless Chromium
# instance plus one ffmpeg transcode running simultaneously. This is a
# starting point, not a load-tested figure — retuning after real traffic is
# expected, not a defect in shipping with this value now.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

APP="${RAVEN_EGRESS_WORKER_APP}"
TAG="${RAVEN_IMAGE_TAG}"

ENVID="$(az containerapp env show -n "${RAVEN_CAE}" -g "${RAVEN_RG}" --query id -o tsv)"
DOMAIN="$(az containerapp env show -n "${RAVEN_CAE}" -g "${RAVEN_RG}" --query properties.defaultDomain -o tsv)"
LOGIN_SERVER="$(az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --query loginServer -o tsv)"

kv() { az keyvault secret show --vault-name "${RAVEN_KV}" -n "$1" --query value -o tsv; }

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
      # Internal: reachable at http://${APP}.internal.${DOMAIN} from
      # anything else in this Container Apps Environment (the API), never
      # from the public internet.
      external: false
      targetPort: ${RAVEN_EGRESS_WORKER_PORT}
      transport: auto
      traffic:
        - latestRevision: true
          weight: 100
    registries:
      - server: ${LOGIN_SERVER}
        identity: system
    secrets:
      - name: egress-worker-shared-secret
        value: $(kv egress-worker-shared-secret)
      - name: egress-storage-connection-string
        value: $(kv egress-storage-connection-string)
      - name: egress-cdn-base-url
        value: $(kv egress-cdn-base-url)
  template:
    containers:
      - image: ${LOGIN_SERVER}/raven-egress-worker:${TAG}
        name: ${APP}
        resources:
          cpu: 1.0
          memory: 2Gi
        env:
          - name: PORT
            value: "${RAVEN_EGRESS_WORKER_PORT}"
          - name: EGRESS_WORKER_SHARED_SECRET
            secretRef: egress-worker-shared-secret
          # The API's own public HTTPS endpoint — its internal Container
          # Apps DNS name works too, since both apps share this
          # environment, and avoids a round trip through Front Door for
          # server-to-server heartbeats.
          - name: API_HEARTBEAT_URL
            value: https://${RAVEN_API_APP}.internal.${DOMAIN}/internal/egress/heartbeat
          - name: AZURE_STORAGE_CONNECTION_STRING
            secretRef: egress-storage-connection-string
          - name: AZURE_STORAGE_CONTAINER
            value: ${RAVEN_EGRESS_CONTAINER}
          - name: CDN_BASE_URL
            secretRef: egress-cdn-base-url
          - name: HLS_SEGMENT_SECONDS
            value: "6"
          - name: HLS_LIST_SIZE
            value: "10"
    scale:
      # Deliberately conservative and manual for this pass — no
      # viewer-count-driven autoscaling (the redesign's own explicit-
      # lifecycle-first requirement). Each replica can run more than one
      # stream's egress session concurrently (EgressManager keys sessions
      # by streamId), so this is a capacity ceiling, not a 1:1 stream ratio.
      minReplicas: 1
      maxReplicas: 3
YAML

if az containerapp show -n "${APP}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "==> Updating ${APP} (new revision, previous kept)"
  az containerapp update -n "${APP}" -g "${RAVEN_RG}" --yaml "${SPEC}" --output none
else
  echo "==> Creating ${APP}"
  az containerapp create -n "${APP}" -g "${RAVEN_RG}" --yaml "${SPEC}" --output none
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
echo "egress-worker: http://${APP}.internal.${DOMAIN} (internal-only — not reachable from outside this Container Apps Environment)"
echo "Now run 13-api-app.sh again so the API picks up EGRESS_WORKER_BASE_URL pointed at this app."
