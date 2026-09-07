#!/usr/bin/env bash
# One-shot Prisma migration as a Container Apps Job.
#
# Deliberately NOT part of the API container's startup: N replicas each
# running `migrate deploy` at boot means N schema-engine sessions contending
# for one advisory lock, and Supabase's :6543 transaction pooler cannot hold
# that lock across the multi-statement DDL a migration needs. The failure is
# a hang or a lock error on every replica. apps/api/Dockerfile's CMD is
# `node dist/main.js` alone for this reason (changed in Phase 1).
#
# This job is the only thing that gets DIRECT_URL (session mode, :5432).
# The API never receives it — it does not read it, and it should not have it.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"
export RAVEN_CAE="${RAVEN_CAE:-raven-env}"
JOB="${RAVEN_MIGRATE_JOB:-raven-migrate}"
TAG="${RAVEN_IMAGE_TAG:-latest}"

LOGIN_SERVER="$(az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --query loginServer -o tsv)"
ACR_USER="$(az acr credential show -n "${RAVEN_ACR}" --query username -o tsv)"
ACR_PASS="$(az acr credential show -n "${RAVEN_ACR}" --query 'passwords[0].value' -o tsv)"
kv() { az keyvault secret show --vault-name "${RAVEN_KV}" -n "$1" --query value -o tsv; }

if az containerapp job show -n "${JOB}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "==> Job ${JOB} exists — updating image to :${TAG}"
  az containerapp job update -n "${JOB}" -g "${RAVEN_RG}" \
    --image "${LOGIN_SERVER}/raven-api:${TAG}" --output none
else
  echo "==> Creating job ${JOB}"
  az containerapp job create \
    --name "${JOB}" --resource-group "${RAVEN_RG}" --environment "${RAVEN_CAE}" \
    --trigger-type Manual \
    --replica-timeout 900 --replica-retry-limit 1 --parallelism 1 \
    --image "${LOGIN_SERVER}/raven-api:${TAG}" \
    --cpu 0.5 --memory 1Gi \
    --registry-server "${LOGIN_SERVER}" \
    --registry-username "${ACR_USER}" --registry-password "${ACR_PASS}" \
    --secrets "direct-url=$(kv direct-url)" "database-url=$(kv database-url)" \
    --env-vars "DIRECT_URL=secretref:direct-url" "DATABASE_URL=secretref:database-url" \
    --command "/bin/sh" \
    --args "-c" "pnpm exec prisma migrate deploy" \
    --output none
  echo "    created"
fi

echo "==> Starting a run"
EXEC="$(az containerapp job start -n "${JOB}" -g "${RAVEN_RG}" --query name -o tsv)"
echo "    execution: ${EXEC}"

echo "==> Waiting for completion"
for i in $(seq 1 40); do
  STATUS="$(az containerapp job execution show -n "${JOB}" -g "${RAVEN_RG}" \
    --job-execution-name "${EXEC}" --query properties.status -o tsv 2>/dev/null || echo Unknown)"
  case "${STATUS}" in
    Succeeded) echo "    ${STATUS}"; break ;;
    Failed|Degraded) echo "    ${STATUS} — migration did NOT apply"; exit 1 ;;
    *) sleep 15 ;;
  esac
done
echo "==> Final: ${STATUS}"
[ "${STATUS}" = "Succeeded" ] || { echo "    did not reach Succeeded in time"; exit 1; }
