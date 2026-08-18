#!/usr/bin/env bash
# Raven — Phase 1 infrastructure verification.
#
# Confirms every local infrastructure service is actually reachable and
# healthy, not just "container running." Run after `pnpm infra:up`:
#
#   pnpm infra:verify
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  echo "error: .env not found. Run: cp .env.example .env" >&2
  exit 1
fi

PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  printf '  %-32s' "$name"
  if "$@" >/tmp/raven-verify-$$.log 2>&1; then
    echo "OK"
    PASS=$((PASS + 1))
  else
    echo "FAILED"
    sed 's/^/      /' "/tmp/raven-verify-$$.log"
    FAIL=$((FAIL + 1))
  fi
  rm -f "/tmp/raven-verify-$$.log"
}

echo "Raven — infrastructure verification"
echo "===================================="

echo
echo "Container status:"
docker compose ps

echo
echo "Health checks:"
check "postgres accepts connections" \
  docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

check "redis responds to auth + ping" \
  docker compose exec -T redis redis-cli -a "${REDIS_PASSWORD}" ping

check "livekit http endpoint responds" \
  bash -c "curl -fsS http://localhost:${LIVEKIT_PORT:-7880} || wget -q -O- http://localhost:${LIVEKIT_PORT:-7880}"

check "coturn responds to STUN binding request" \
  docker compose exec -T coturn turnutils_stunclient -p 3478 127.0.0.1

check "api /health reports ok" \
  bash -c "curl -fsS http://localhost:${API_PORT:-4100}/health | grep -q '\"status\":\"ok\"'"

check "api /docs (Swagger) is served" \
  bash -c "curl -fsS -o /dev/null -w '%{http_code}' http://localhost:${API_PORT:-4100}/docs | grep -q '^200$'"

echo
echo "Docker network membership:"
check "all 5 services on raven-network" \
  bash -c '[ "$(docker network inspect raven-network --format "{{len .Containers}}")" = "5" ]'

echo
echo "===================================="
echo "Passed: ${PASS}  Failed: ${FAIL}"

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi

echo "All infrastructure checks passed."
