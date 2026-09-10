#!/usr/bin/env bash
# Build and push the Livqeno API image to ACR.
#
# Reuses apps/api/Dockerfile unchanged. Build context is the REPO ROOT, not
# apps/api — it is a pnpm workspace package and needs its siblings visible
# to resolve deps (the Dockerfile's own header says so).
#
# --platform linux/amd64 because Container Apps runs x86_64 and this may be
# built on Apple Silicon.
#
# No separate worker image: the API runs its background jobs in-process,
# coordinated by a Redis lock (infrastructure/k8s/README.md explains why).
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${RAVEN_IMAGE_TAG:-$(git -C "${REPO_ROOT}" rev-parse --short HEAD)}"
LOGIN_SERVER="$(az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --query loginServer -o tsv)"

echo "==> az acr login"
az acr login -n "${RAVEN_ACR}" >/dev/null

echo "==> Building raven-api:${TAG} (context: repo root)"
docker build \
  --platform linux/amd64 \
  -f "${REPO_ROOT}/apps/api/Dockerfile" \
  -t "${LOGIN_SERVER}/raven-api:${TAG}" \
  -t "${LOGIN_SERVER}/raven-api:latest" \
  "${REPO_ROOT}"

echo "==> Pushing"
docker push "${LOGIN_SERVER}/raven-api:${TAG}"
docker push "${LOGIN_SERVER}/raven-api:latest"

echo "==> Tags"
az acr repository show-tags -n "${RAVEN_ACR}" --repository raven-api -o table
