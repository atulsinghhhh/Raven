#!/usr/bin/env bash
# Build and push the egress-worker image to ACR.
#
# Reuses services/egress-worker/Dockerfile unchanged. Build context is the
# REPO ROOT, not services/egress-worker — it's a pnpm workspace package
# that needs packages/sdk, packages/chat-sdk and packages/client visible to
# build the real SDK bundle its browser harness imports (see the
# Dockerfile's own header comment and services/egress-worker/scripts/
# stage-harness-sdk.mjs).
#
# --platform linux/amd64: same reasoning as 09-api-image.sh.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${RAVEN_IMAGE_TAG}"
GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
LOGIN_SERVER="$(az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --query loginServer -o tsv)"

echo "==> az acr login"
az acr login -n "${RAVEN_ACR}" >/dev/null

echo "==> Building raven-egress-worker:${TAG} (and :${GIT_SHA}) (context: repo root)"
docker build \
  --platform linux/amd64 \
  -f "${REPO_ROOT}/services/egress-worker/Dockerfile" \
  -t "${LOGIN_SERVER}/raven-egress-worker:${TAG}" \
  -t "${LOGIN_SERVER}/raven-egress-worker:${GIT_SHA}" \
  "${REPO_ROOT}"

echo "==> Pushing"
docker push "${LOGIN_SERVER}/raven-egress-worker:${TAG}"
if [ "${TAG}" != "${GIT_SHA}" ]; then
  docker push "${LOGIN_SERVER}/raven-egress-worker:${GIT_SHA}"
fi

echo "==> Tags"
az acr repository show-tags -n "${RAVEN_ACR}" --repository raven-egress-worker -o table
