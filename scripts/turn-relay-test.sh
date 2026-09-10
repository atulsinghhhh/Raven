#!/usr/bin/env bash
set -euo pipefail

# Forced-TURN-relay media test (spec §41).
#
# Closes the gap docs/rtc/test-matrix.md §5 called the worst one it had:
# "Relay-only has never been exercised." Two real Pion clients join a real
# room on a real SFU with `iceTransportPolicy: relay`, so their ICE agents
# gather nothing but TURN-allocated candidates — a connection that comes up
# cannot have taken a host or STUN path — and then RTP is read off the far
# side to prove media actually crossed the relay.
#
# The tests live behind the `turnrelay` build tag
# (services/sfu/internal/room/turn_relay_test.go) rather than in the default
# suite, because they need a reachable coturn with a known shared secret and
# `go test ./...` has no way to provide one.
#
# Usage:
#   scripts/turn-relay-test.sh                      # in coturn's Docker network, UDP
#   scripts/turn-relay-test.sh --transport tcp      # TURN over TCP
#   scripts/turn-relay-test.sh --host               # from the host, via published ports
#
# Requires: Go, a running coturn (`docker compose up -d coturn`), and
# TURN_SECRET — taken from the environment, or read out of .env.
#
# --host vs the default: the default runs the test inside a throwaway
# container attached to coturn's own Docker network, so client, coturn and
# the in-process SFU all address each other consistently. --host runs the
# same binary natively against the published TURN port. Both work on Docker
# Desktop; the topology that does *not* is a browser on the host against a
# containerised SFU, and that limitation is a dev-environment artifact
# rather than a product one — see docs/turn.md#known-limitations.

cd "$(dirname "$0")/.."

TRANSPORT=udp
MODE=in-network
NETWORK=raven-network
RUNTIME_IMAGE=alpine:3

while [ $# -gt 0 ]; do
  case "$1" in
    --transport) TRANSPORT="${2:?--transport needs udp or tcp}"; shift 2 ;;
    --host) MODE=host; shift ;;
    --network) NETWORK="${2:?--network needs a docker network name}"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

case "$TRANSPORT" in
  udp|tcp) ;;
  *) echo "--transport must be udp or tcp, got '$TRANSPORT'" >&2; exit 2 ;;
esac

if ! command -v go >/dev/null 2>&1; then
  echo "go not found — needed to build the relay tests." >&2
  exit 1
fi

# The secret is never printed, and never passed on a command line that ends
# up in a shell history: it goes to the container as an env var only.
if [ -z "${TURN_SECRET:-}" ] && [ -f .env ]; then
  TURN_SECRET=$(grep -m1 '^TURN_SECRET=' .env | cut -d= -f2- | tr -d "\"'" | tr -d '\r' || true)
fi
if [ -z "${TURN_SECRET:-}" ]; then
  echo "TURN_SECRET is not set and was not found in .env." >&2
  echo "coturn authenticates every allocation — there is no anonymous relay." >&2
  exit 1
fi

mkdir -p scripts/results
STAMP=$(date +%Y%m%dT%H%M%S)
OUT="scripts/results/turn-relay-${MODE}-${TRANSPORT}-${STAMP}.log"

echo "Forced-TURN-relay test: mode=${MODE} transport=${TRANSPORT}"
echo "Output: ${OUT}"
echo

if [ "$MODE" = host ]; then
  if ! docker ps --format '{{.Names}}' | grep -q '^raven-coturn$'; then
    echo "raven-coturn is not running — start it with: docker compose up -d coturn" >&2
    exit 1
  fi
  (
    cd services/sfu
    TURN_HOST="${TURN_HOST:-localhost}" \
    TURN_PORT="${TURN_PORT:-3478}" \
    TURN_SECRET="$TURN_SECRET" \
    TURN_TRANSPORT="$TRANSPORT" \
      go test -tags turnrelay ./internal/room/ \
        -run 'TestTURNRelayOnlyForwardsMedia|TestDirectPathForwardingBaseline' \
        -count=1 -v -timeout 5m
  ) 2>&1 | tee "$OUT"
else
  if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
    echo "docker network '$NETWORK' does not exist — start the stack first, or pass --network." >&2
    exit 1
  fi

  # Cross-compile for the Docker VM's architecture rather than the host's:
  # on Apple silicon those agree, but on a Linux/amd64 host with an arm
  # builder (or the reverse) they do not, and a wrong-arch binary fails as
  # "exec format error" with nothing to say about TURN.
  ARCH=$(docker info --format '{{.Architecture}}')
  case "$ARCH" in
    aarch64|arm64) GOARCH=arm64 ;;
    x86_64|amd64)  GOARCH=amd64 ;;
    *) echo "unsupported docker architecture: $ARCH" >&2; exit 1 ;;
  esac

  BIN_DIR=$(mktemp -d)
  trap 'rm -rf "$BIN_DIR"' EXIT

  echo "Building the relay test for linux/${GOARCH}…"
  (
    cd services/sfu
    GOOS=linux GOARCH="$GOARCH" CGO_ENABLED=0 \
      go test -tags turnrelay -c -o "$BIN_DIR/turnrelay.test" ./internal/room/
  )

  docker run --rm --network "$NETWORK" \
    -e TURN_HOST="${TURN_HOST:-coturn}" \
    -e TURN_PORT="${TURN_PORT:-3478}" \
    -e TURN_SECRET="$TURN_SECRET" \
    -e TURN_TRANSPORT="$TRANSPORT" \
    -v "$BIN_DIR":/t:ro \
    "$RUNTIME_IMAGE" /t/turnrelay.test \
      -test.run 'TestTURNRelayOnlyForwardsMedia|TestDirectPathForwardingBaseline' \
      -test.v -test.timeout 5m \
    2>&1 | tee "$OUT"
fi

cat <<'NOTE'

────────────────────────────────────────────────────────────────────────
What this proves

  Media published by one relay-only client reaches another relay-only
  client through Livqeno's SFU: both legs of the path are TURN-relayed, and
  the assertion is on the nominated ICE candidate pair's candidate types
  (local=relay) plus RTP read off the subscriber's track. coturn
  authenticated both allocations against the time-limited HMAC credential
  scheme the control plane mints, so the credential format is proven on
  the wire and not only in a unit test.

  The forwarding-latency lines are one-way publish→receive times, off one
  clock in one process, for the relay path and for a direct-path baseline
  run back to back on the same machine. The useful figure is the delta
  between them, not either absolute number.

What this does NOT prove

  · Capacity. Two clients, a synthetic 100-packet-per-second stream, no
    encoder and no real codec bitrate.
  · Latency on a real network. Every hop above is a container bridge or
    loopback; the absolute numbers are a floor, not a forecast.
  · TURNS (TLS). coturn's local cert is self-signed, which Pion rejects
    for the same reason browsers do. Server-side TLS is verified
    separately with turnutils_uclient — see docs/turn.md#tls.
  · Symmetric NAT. Relay-only is forced by policy here, not by a NAT that
    left no alternative.
  · A browser. These are Pion clients; docs/rtc/test-matrix.md §4 covers
    the browser matrix, and Firefox and Safari remain untested.
────────────────────────────────────────────────────────────────────────
NOTE
