#!/usr/bin/env bash
set -euo pipefail

# RTC media-plane load test — the one surface this repo deliberately
# does NOT hand-roll a load generator for. `lk load-test` (LiveKit's own
# CLI, part of livekit-cli — `brew install livekit-cli`) synthesizes
# real publishers/subscribers against a real LiveKit server without
# needing actual camera/mic capture at scale, which is exactly what's
# needed to test the SFU honestly instead of faking media.
#
# This measures the SFU side of RTC capacity only. The control-plane
# side (how fast apps/api can mint RTC tokens under load) is a
# different bottleneck, covered by scripts/k6/api-load-test.js's
# mint_rtc_token requests — see scripts/k6/README.md for why these are
# kept separate rather than conflated into one "RTC" number.
#
# Usage:
#   scripts/rtc-load-test.sh --publishers 10 --subscribers 40 --duration 2m
#   # any flag lk load-test accepts can be passed through, e.g.:
#   scripts/rtc-load-test.sh --publishers 5 --subscribers 20 --video-resolution low
#
# Requires: `lk` (livekit-cli) on PATH, and a running LiveKit instance
# (docker compose up -d livekit — see docker-compose.yml).

cd "$(dirname "$0")/.."

if ! command -v lk >/dev/null 2>&1; then
  echo "lk (livekit-cli) not found. Install it first:" >&2
  echo "  brew install livekit-cli" >&2
  exit 1
fi

# .env holds the real local values (LIVEKIT_URL/API_KEY/API_SECRET) —
# same file docker-compose.yml and apps/api read, so this test always
# targets whatever LiveKit instance is actually configured, not a
# hardcoded guess.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${LIVEKIT_URL:?Set LIVEKIT_URL (see .env.example) — where is LiveKit reachable from this machine?}"
: "${LIVEKIT_API_KEY:?Set LIVEKIT_API_KEY}"
: "${LIVEKIT_API_SECRET:?Set LIVEKIT_API_SECRET}"

mkdir -p scripts/results
STAMP=$(date +%Y%m%dT%H%M%S)
ROOM="rtc-load-test-${STAMP}"
OUT="scripts/results/rtc-load-test-${STAMP}.log"

echo "Running lk load-test against ${LIVEKIT_URL}, room ${ROOM}"
echo "Output: ${OUT}"
echo

lk load-test \
  --url "$LIVEKIT_URL" \
  --api-key "$LIVEKIT_API_KEY" \
  --api-secret "$LIVEKIT_API_SECRET" \
  --room "$ROOM" \
  "$@" \
  2>&1 | tee "$OUT"
