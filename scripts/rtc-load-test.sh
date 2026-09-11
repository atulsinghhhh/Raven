#!/usr/bin/env bash
set -euo pipefail

# RTC media-plane scale test.
#
# Drives the SFU's own Go scale tests, which synthesize real Pion
# publishers and subscribers against a real forwarding path — real ICE,
# real DTLS-SRTP, real RTP read off the far side. Nothing here is mocked
# below the room API.
#
# This replaced a wrapper around `lk load-test` (LiveKit's CLI), which
# stopped being applicable when Livqeno's own SFU replaced LiveKit. The
# capability that wrapper had and this does not is documented under
# "What this does not measure" below — stated rather than quietly lost.
#
# The control-plane side (how fast apps/api mints RTC tokens under load)
# is a different bottleneck, covered by scripts/k6/api-load-test.js's
# mint_rtc_token requests. See scripts/k6/README.md for why the two are
# kept separate rather than conflated into one "RTC" number.
#
# Usage:
#   scripts/rtc-load-test.sh              # 2, 10, 50 participants + a 20-way mesh
#   scripts/rtc-load-test.sh --with-100   # adds the 100-participant case
#
# Requires: Go (see services/sfu/go.mod). No running stack, no Docker —
# these tests bring up their own SFU in-process.

cd "$(dirname "$0")/.."

if ! command -v go >/dev/null 2>&1; then
  echo "go not found — needed to run the SFU's scale tests." >&2
  echo "  https://go.dev/dl/" >&2
  exit 1
fi

WITH_100=0
for arg in "$@"; do
  case "$arg" in
    --with-100) WITH_100=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p scripts/results
STAMP=$(date +%Y%m%dT%H%M%S)
OUT="scripts/results/rtc-load-test-${STAMP}.log"

PATTERN='TestScaleParticipants|TestScaleMeshRoom'
if [ "$WITH_100" -eq 1 ]; then
  PATTERN="${PATTERN}|TestScale100Participants"
fi

echo "Running SFU scale tests (${PATTERN})"
echo "Output: ${OUT}"
echo

cd services/sfu
go test ./internal/room/ \
  -run "$PATTERN" \
  -count=1 \
  -v \
  -timeout 20m \
  2>&1 | tee "../../${OUT}"

cat <<'NOTE'

────────────────────────────────────────────────────────────────────────
What this measures

  N real PeerConnections joining one room, the SFU building the complete
  forwarding mesh, and RTP actually arriving at every subscriber at that
  size. The join times printed above are wall clock on loopback.

What this does NOT measure — and must not be quoted as capacity

  Every participant above runs in the same process as the SFU, over
  loopback, with a synthetic 100-packet-per-second stream: no encoder,
  no jitter, no loss, no NAT, no TURN, no real codec bitrate.

  Still unmeasured, and without a number:
    · participants per node at real codec bitrates on real hardware
    · CPU and memory per participant, and therefore cost per call
    · behaviour under packet loss and added latency
    · browser interoperability at scale
    · mobile (iOS, Android)
    · NAT traversal across the real matrix, including TURN relay
    · Wi-Fi <-> cellular handover mid-call

  Livqeno does not claim a supported participant count. See
  docs/rtc/scaling.md for what would have to be measured to change that.
────────────────────────────────────────────────────────────────────────
NOTE
