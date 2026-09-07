#!/usr/bin/env bash
# End-to-end check against the deployed API.
#
# Exercises the real chain rather than health endpoints alone: a Prisma
# write, bcrypt+pepper API key issuance, room creation, and an RTC token
# mint (which is what produces the TURN credentials coturn has to accept).
#
# Creates a throwaway developer account. Harmless, but it is real data in
# the real database — the email is timestamped so re-runs do not collide.
#
# Usage: ./api-e2e.sh https://raven-api.<env>.eastasia.azurecontainerapps.io
set -uo pipefail
API="${1:?usage: api-e2e.sh <api-base-url>}"
EMAIL="phase3-verify-$(date +%s)@example.com"
PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

echo "=== register (Prisma write) ==="
REG="$(curl -s --max-time 30 -X POST "$API/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Phase3-Verify-Pw!\",\"name\":\"Phase 3 Verify\"}")"
TOKEN="$(printf '%s' "$REG" | jq_ "d.get('accessToken','')")"
[ -n "$TOKEN" ] && ok "developer created, session JWT issued" || { bad "register: $REG"; exit 1; }

echo "=== create project (write) ==="
PROJ="$(curl -s --max-time 30 -X POST "$API/v1/projects" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"phase3-verify"}')"
PID="$(printf '%s' "$PROJ" | jq_ "d.get('id','')")"
[ -n "$PID" ] && ok "project created ($PID)" || { bad "project: $PROJ"; exit 1; }

echo "=== read back (Prisma read) ==="
LIST="$(curl -s --max-time 30 "$API/v1/projects" -H "Authorization: Bearer $TOKEN")"
printf '%s' "$LIST" | grep -q "$PID" && ok "project readable via GET /v1/projects" || bad "read back: $LIST"

echo "=== issue API key (bcrypt + pepper) ==="
KEY="$(curl -s --max-time 30 -X POST "$API/v1/projects/$PID/api-keys" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"phase3","environment":"PRODUCTION"}')"
APIKEY="$(printf '%s' "$KEY" | jq_ "d.get('key') or d.get('secret') or ''")"
[ -n "$APIKEY" ] && ok "API key issued (shown once)" || { bad "api key: $KEY"; exit 1; }

echo "=== create room (machine auth) ==="
ROOM="$(curl -s --max-time 30 -X POST "$API/v1/rooms" \
  -H "Authorization: Bearer $APIKEY" -H 'Content-Type: application/json' \
  -d '{"name":"phase3-verify-room"}')"
RID="$(printf '%s' "$ROOM" | jq_ "d.get('id','')")"
[ -n "$RID" ] && ok "room created ($RID)" || { bad "room: $ROOM"; exit 1; }

echo "=== mint RTC token (allocation + TURN credentials) ==="
TOK="$(curl -s --max-time 30 -X POST "$API/v1/rooms/$RID/rtc-tokens" \
  -H "Authorization: Bearer $APIKEY" -H 'Content-Type: application/json' \
  -d '{"participantIdentity":"phase3-verifier","permissions":{"join":true,"publish":true,"subscribe":true}}')"

printf '%s' "$TOK" | jq_ "d.get('token','')" | grep -q . \
  && ok "RTC token signed" || bad "rtc token: $TOK"

ENDPOINT="$(printf '%s' "$TOK" | jq_ "d.get('endpoint','')")"
case "$ENDPOINT" in
  wss://*) ok "signaling endpoint is wss:// ($ENDPOINT)" ;;
  *)       bad "signaling endpoint not wss://: '$ENDPOINT'" ;;
esac

ICE="$(printf '%s' "$TOK" | jq_ "json.dumps(d.get('iceServers',[]))")"
printf '%s' "$ICE" | grep -q '"stun:' && ok "iceServers include stun:" || bad "no stun: in iceServers"
printf '%s' "$ICE" | grep -q '"turn:' && ok "iceServers include turn:" || bad "no turn: in iceServers"
printf '%s' "$ICE" | grep -q '"turns:' \
  && ok "iceServers include turns: (TLS advertised)" \
  || bad "no turns: — TURN_TLS_PORT not set on the API?"
# The TURN host must be a resolvable hostname with a valid certificate, not a
# bare IP (a cert cannot be issued for an IP, so turns: would fail). Override
# the expectation with RAVEN_EXPECT_TURN_HOST when the domain changes; do not
# hardcode one hostname here, or a cutover turns a correct result into a
# failure.
EXPECT_TURN="${RAVEN_EXPECT_TURN_HOST:-}"
TURN_IN_ICE="$(printf '%s' "$ICE" | grep -oE 'turns?:[^:"?]+' | head -1 | cut -d: -f2)"
if [ -n "$EXPECT_TURN" ]; then
  [ "$TURN_IN_ICE" = "$EXPECT_TURN" ] \
    && ok "TURN host is ${TURN_IN_ICE} (matches expected)" \
    || bad "TURN host is ${TURN_IN_ICE}, expected ${EXPECT_TURN}"
elif printf '%s' "$TURN_IN_ICE" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  bad "TURN host is a bare IP (${TURN_IN_ICE}) — turns: cannot present a valid cert"
elif printf '%s' "$TURN_IN_ICE" | grep -q '\.'; then
  ok "TURN host is a hostname, not a bare IP (${TURN_IN_ICE})"
else
  bad "TURN host looks wrong: ${TURN_IN_ICE:-none}"
fi

echo "=== SFU registry ==="
SRV="$(curl -s --max-time 30 "$API/v1/rtc/servers" -H "Authorization: Bearer $TOKEN")"
printf '%s' "$SRV" | grep -q 'sfu-eastasia' \
  && ok "SFU node visible in the registry" || bad "registry: $SRV"

echo
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
