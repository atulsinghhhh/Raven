#!/usr/bin/env bash
# Runs several capacity scenarios back to back, waiting for the machine to
# go quiet between them.
#
# Chaining them without the wait does not work: Chromium takes tens of
# seconds to reap a hundred renderer processes, so the next scenario's
# baseline guard sees the previous one's teardown and refuses to start —
# which is the guard doing its job, and is still a run that produced
# nothing. This settles first and then goes.
set -uo pipefail
cd "$(dirname "$0")"

QUIET=${QUIET_LOAD:-3.0}
SETTLE_TIMEOUT=${SETTLE_TIMEOUT:-300}

settle() {
  local waited=0
  while [ "$waited" -lt "$SETTLE_TIMEOUT" ]; do
    local load
    load=$(uptime | sed 's/.*load averages*: //' | awk '{print $1}' | tr -d ',')
    if awk -v l="$load" -v q="$QUIET" 'BEGIN { exit !(l < q) }'; then
      echo "--- settled at load ${load} ---"
      return 0
    fi
    sleep 10
    waited=$((waited + 10))
  done
  echo "--- gave up waiting for quiet after ${SETTLE_TIMEOUT}s ---"
}

for scenario in "$@"; do
  echo "###### ${scenario} ######"
  settle
  # shellcheck disable=SC2086
  node run.mjs ${scenario} --skip-sdk-build --skip-api-build
  echo "###### ${scenario} EXIT=$? ######"
done
echo "###### SEQUENCE COMPLETE ######"
