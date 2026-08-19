#!/usr/bin/env bash
set -euo pipefail

# Runs scripts/chat-load-test.mjs (the existing, proven chat load
# generator — see that file's own header) once per running `api`
# replica, in parallel, one process per discovered target — so chat
# load actually spreads across a horizontally-scaled fleet instead of
# hammering a single instance while the others sit idle. This is
# orchestration, not a reimplementation: the actual WS client, metrics,
# and "what this does/doesn't prove" caveats all still live in that one
# script, unchanged.
#
# Usage:
#   docker compose -f docker-compose.yml -f docker-compose.scale.yml \
#     up -d --scale api=3
#   scripts/k6/chat-scaled-load-test.sh --connections 200 --senders 50 --rate 2 --duration 30
#
# Every flag after the script name is forwarded to each instance of
# chat-load-test.mjs verbatim, except --connections, which is divided
# evenly across the discovered replicas (each replica gets its own
# share of the total, provisioned against its own API key/rooms so the
# runs don't collide).
#
# Output: one results file per replica under scripts/results/, plus a
# combined view printed at the end. Reading the totals across files is
# a manual step (see docs/production/capacity-report.md) — this script
# only runs the generators and captures their output.

cd "$(dirname "$0")/../.."
mkdir -p scripts/results

TARGETS_RAW=$(scripts/k6/discover-api-targets.sh)
IFS=',' read -ra TARGETS <<< "$TARGETS_RAW"
NUM_TARGETS=${#TARGETS[@]}

TOTAL_CONNECTIONS=100
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --connections)
      TOTAL_CONNECTIONS="$2"
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

PER_REPLICA_CONNECTIONS=$(( (TOTAL_CONNECTIONS + NUM_TARGETS - 1) / NUM_TARGETS ))
STAMP=$(date +%Y%m%dT%H%M%S)

echo "Provisioning one API key (every replica shares the same Postgres/Redis, so provisioning against one is enough)..."
API_KEY=$(node "$(dirname "$0")/provision-api-key.mjs" "${TARGETS[0]}")
echo "  done."
echo

echo "Spreading ${TOTAL_CONNECTIONS} total connections across ${NUM_TARGETS} replica(s):"
echo "  ${PER_REPLICA_CONNECTIONS} connections per replica (rounded up)."
echo

pids=()
i=0
for target in "${TARGETS[@]}"; do
  i=$((i + 1))
  out="scripts/results/chat-loadtest-${STAMP}-replica${i}.log"
  echo "  replica ${i} (${target}) -> ${out}"
  (
    node scripts/chat-load-test.mjs \
      --api-url "$target" \
      --api-key "$API_KEY" \
      --connections "$PER_REPLICA_CONNECTIONS" \
      "${ARGS[@]}" \
      > "$out" 2>&1
  ) &
  pids+=($!)
done

echo
echo "Running ${NUM_TARGETS} instance(s) in parallel — waiting for all to finish..."
status=0
for pid in "${pids[@]}"; do
  wait "$pid" || status=1
done

echo
echo "─── combined output ───"
for f in scripts/results/chat-loadtest-${STAMP}-replica*.log; do
  echo
  echo "=== $f ==="
  cat "$f"
done

exit $status
