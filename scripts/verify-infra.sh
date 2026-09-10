#!/usr/bin/env bash
# Checks that every infra dependency is actually reachable and healthy, not
# just "container running." Covers the local compose stack plus the one
# external dependency, Supabase Postgres. Run after `pnpm infra:up`:
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

echo "Livqeno — infrastructure verification"
echo "===================================="

echo
echo "Container status:"
docker compose ps

echo
echo "Health checks:"
# Not a container check: the database is managed Postgres on Supabase,
# external to this compose stack (docs/deployment/managed-postgres.md).
# Driven through the same `pg` client apps/api uses, so a pass here means
# the app's own connection path works — not merely that a port is open.
# Run from apps/api: `pg` is that package's dependency and pnpm does not
# hoist it to the workspace root.
check "supabase postgres answers SELECT 1" \
  bash -c 'cd apps/api && node --input-type=module -e "
    import pg from \"pg\";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(\"SELECT 1\");
    await client.end();
  "'

check "redis responds to auth + ping" \
  docker compose exec -T redis redis-cli -a "${REDIS_PASSWORD}" ping

check "sfu liveness endpoint responds" \
  bash -c "curl -fsS http://localhost:${SFU_HTTP_PORT:-7000}/healthz || wget -q -O- http://localhost:${SFU_HTTP_PORT:-7000}/healthz"

check "coturn responds to STUN binding request" \
  docker compose exec -T coturn turnutils_stunclient -p 3478 127.0.0.1

check "api /health reports ok" \
  bash -c "curl -fsS http://localhost:${API_PORT:-4100}/health | grep -q '\"status\":\"ok\"'"

check "api /docs (Swagger) is served" \
  bash -c "curl -fsS -o /dev/null -w '%{http_code}' http://localhost:${API_PORT:-4100}/docs | grep -q '^200$'"

echo
echo "Docker network membership:"
# redis, sfu, coturn, minio, api. Postgres is deliberately absent — it is
# on Supabase, not in this stack. minio-init exits after creating the
# bucket, so it is not counted.
check "all 5 services on raven-network" \
  bash -c '[ "$(docker network inspect raven-network --format "{{len .Containers}}")" = "5" ]'

echo
echo "===================================="
echo "Passed: ${PASS}  Failed: ${FAIL}"

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi

echo "All infrastructure checks passed."
