#!/usr/bin/env bash
# Build and push the SFU image to ACR.
#
# --platform linux/amd64 is not optional when building from an Apple Silicon
# machine: the VMs are AMD x86_64 (Basv2). A native arm64 build pushed here
# fails to start with "exec format error".
#
# apps/api is NOT built here. That image is Phase 3, and its build context is
# the repo root (pnpm workspace) rather than a single directory.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${RAVEN_IMAGE_TAG:-$(git -C "${REPO_ROOT}" rev-parse --short HEAD)}"
LOGIN_SERVER="$(az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --query loginServer -o tsv)"

echo "==> az acr login ${RAVEN_ACR}"
az acr login -n "${RAVEN_ACR}" >/dev/null

echo "==> Building raven-sfu:${TAG} for linux/amd64"
docker build \
  --platform linux/amd64 \
  -t "${LOGIN_SERVER}/raven-sfu:${TAG}" \
  -t "${LOGIN_SERVER}/raven-sfu:latest" \
  --build-arg "VERSION=${TAG}" \
  "${REPO_ROOT}/services/sfu"

echo "==> Pushing"
docker push "${LOGIN_SERVER}/raven-sfu:${TAG}"
docker push "${LOGIN_SERVER}/raven-sfu:latest"

echo "==> Repository contents"
az acr repository show-tags -n "${RAVEN_ACR}" --repository raven-sfu -o table
