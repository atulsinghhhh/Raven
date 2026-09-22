#!/usr/bin/env bash
# Deploy / update the postgres-exporter Container App (10k-scaling audit,
# Phase 1 — observability). Exposes Postgres connection/query/lock metrics
# for the managed Supabase database on /metrics.
#
# Internal ingress only, same as egress-worker — nothing outside this
# Container Apps Environment can reach it, and nothing in this repo
# scrapes it yet (no Prometheus server exists anywhere in the stack); this
# stands the endpoint up for whatever eventually does.
#
# No ACR, no managed identity, no AcrPull role: unlike raven-api and
# raven-egress-worker, this runs prometheuscommunity/postgres-exporter's
# own public image unmodified — there is no Livqeno code in it to build or
# to keep private.
#
# Same idempotent create-or-update + YAML-spec pattern as 13-api-app.sh/
# 17-egress-worker-app.sh; see 17-egress-worker-app.sh's header for why
# the initial create still goes through plain flags before the YAML
# update — `az containerapp create --yaml` is broken on this CLI/extension
# version regardless of what the spec contains.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

APP="${RAVEN_POSTGRES_EXPORTER_APP}"

ENVID="$(az containerapp env show -n "${RAVEN_CAE}" -g "${RAVEN_RG}" --query id -o tsv)"
DOMAIN="$(az containerapp env show -n "${RAVEN_CAE}" -g "${RAVEN_RG}" --query properties.defaultDomain -o tsv)"

kv() { az keyvault secret show --vault-name "${RAVEN_KV}" -n "$1" --query value -o tsv; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
SPEC="${WORK}/app.yaml"
umask 077

# postgres_exporter wants a plain libpq DSN in DATA_SOURCE_NAME, and the
# existing `database-url` secret (05-secrets.sh, already consumed by
# 13-api-app.sh) is already exactly that — the same pooled Supabase
# connection string the API itself uses. No new secret to provision.
cat > "${SPEC}" <<YAML
location: ${RAVEN_LOCATION}
properties:
  environmentId: ${ENVID}
  configuration:
    activeRevisionsMode: Multiple
    ingress:
      # Internal: reachable at http://${APP}.internal.${DOMAIN} from
      # anything else in this Container Apps Environment, never from the
      # public internet — matches egress-worker's own ingress shape.
      external: false
      targetPort: ${RAVEN_POSTGRES_EXPORTER_PORT}
      transport: auto
      traffic:
        - latestRevision: true
          weight: 100
    secrets:
      - name: database-url
        value: $(kv database-url)
  template:
    containers:
      - image: quay.io/prometheuscommunity/postgres-exporter:v0.15.0
        name: ${APP}
        resources:
          # This does nothing but run periodic read-only queries against
          # pg_stat_* views — far lighter than the API or egress-worker.
          cpu: 0.25
          memory: 0.5Gi
        env:
          - name: DATA_SOURCE_NAME
            secretRef: database-url
          - name: PG_EXPORTER_WEB_LISTEN_ADDRESS
            value: ":${RAVEN_POSTGRES_EXPORTER_PORT}"
    scale:
      # One replica, deliberately. This has no request load to scale
      # against — it is a single periodic scraper of one database — and a
      # second replica would just double-count nothing anyone reads yet.
      minReplicas: 1
      maxReplicas: 1
YAML

if az containerapp show -n "${APP}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "==> Updating ${APP} (new revision, previous kept)"
  az containerapp update -n "${APP}" -g "${RAVEN_RG}" --yaml "${SPEC}" --output none
else
  echo "==> Creating ${APP} (bootstrap via flags — see header comment on the --yaml create bug)"
  az containerapp create -n "${APP}" -g "${RAVEN_RG}" --environment "${RAVEN_CAE}" \
    --image "quay.io/prometheuscommunity/postgres-exporter:v0.15.0" \
    --ingress internal --target-port "${RAVEN_POSTGRES_EXPORTER_PORT}" \
    --output none
  echo "==> Applying the full spec (real env + config)"
  az containerapp update -n "${APP}" -g "${RAVEN_RG}" --yaml "${SPEC}" --output none
fi

echo "==> Waiting for the latest revision"
for _ in $(seq 1 20); do
  STATE="$(az containerapp revision list -n "${APP}" -g "${RAVEN_RG}" \
    --query "reverse(sort_by([].{c:properties.createdTime,r:properties.runningState},&c))[0].r" -o tsv 2>/dev/null || true)"
  [ "${STATE}" = "Running" ] && break
  case "${STATE}" in Failed|ActivationFailed|Degraded) echo "    ${STATE}"; break ;; esac
  sleep 15
done
echo "    ${STATE}"

echo
echo "postgres-exporter: http://${APP}.internal.${DOMAIN}/metrics (internal-only — not reachable from outside this Container Apps Environment)"
