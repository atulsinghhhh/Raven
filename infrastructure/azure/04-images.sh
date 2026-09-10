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
# One tag source, shared with 06-deploy-sfu.sh: RAVEN_IMAGE_TAG from
# 00-variables.sh (default `latest`). This script used to default to the
# short SHA while the deploy script defaulted to `latest`, so running the
# two back to back shipped one image and ran another.
TAG="${RAVEN_IMAGE_TAG}"
# Pushed alongside TAG on every build, so a mutable tag never costs
# traceability: whatever `latest` points at now, this SHA is exactly this
# tree.
GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
LOGIN_SERVER="$(az acr show -n "${RAVEN_ACR}" -g "${RAVEN_RG}" --query loginServer -o tsv)"

echo "==> az acr login ${RAVEN_ACR}"
az acr login -n "${RAVEN_ACR}" >/dev/null

echo "==> Building raven-sfu:${TAG} (and :${GIT_SHA}) for linux/amd64"
docker build \
  --platform linux/amd64 \
  -t "${LOGIN_SERVER}/raven-sfu:${TAG}" \
  -t "${LOGIN_SERVER}/raven-sfu:${GIT_SHA}" \
  --build-arg "VERSION=${TAG}" \
  "${REPO_ROOT}/services/sfu"

echo "==> Pushing"
docker push "${LOGIN_SERVER}/raven-sfu:${TAG}"
# Skipped when TAG already *is* the SHA, since that is the same push twice.
if [ "${TAG}" != "${GIT_SHA}" ]; then
  docker push "${LOGIN_SERVER}/raven-sfu:${GIT_SHA}"
fi

# `latest` is no longer moved as a side effect of a tagged build. It moves
# when TAG is `latest` — the default — and not when you asked for
# RAVEN_IMAGE_TAG=some-branch, which previously repointed `latest` at a
# feature build and left the next default deploy running it.

echo "==> Repository contents"
az acr repository show-tags -n "${RAVEN_ACR}" --repository raven-sfu -o table
