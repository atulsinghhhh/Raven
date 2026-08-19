#!/usr/bin/env bash
set -euo pipefail

# Prints a comma-separated list of "http://localhost:<port>", one per
# currently-running `api` replica started under docker-compose.scale.yml
# (see that file's header comment for why plain docker-compose.yml can't
# do this: a fixed container_name and host port both reject --scale>1).
#
# --scale assigns each replica a random host port instead of a fixed
# one, so there's no port to hardcode — this discovers the real
# assignments and hands them to k6's lib/targets.js round-robin helper.
#
# Usage:
#   docker compose -f docker-compose.yml -f docker-compose.scale.yml \
#     up -d --scale api=3
#   TARGETS=$(scripts/k6/discover-api-targets.sh)
#   k6 run -e TARGETS="$TARGETS" scripts/k6/api-load-test.js

cd "$(dirname "$0")/../.."

targets=$(docker compose -f docker-compose.yml -f docker-compose.scale.yml ps api --format json \
  | jq -r '.Publishers[] | select(.URL == "0.0.0.0") | .PublishedPort' \
  | awk '{print "http://localhost:" $1}' \
  | paste -sd, -)

if [ -z "$targets" ]; then
  echo "No running 'api' replicas found under docker-compose.scale.yml. Start some first:" >&2
  echo "  docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale api=<N>" >&2
  exit 1
fi

echo "$targets"
