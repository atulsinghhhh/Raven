#!/usr/bin/env bash
# Verify the ravenstack.online cutover end to end. Read-only.
#
# Every check is a real request against the public hostname, not a reading of
# the config that produced it.
#
# Usage: ./verify-domains.sh [domain]
set -uo pipefail
DOMAIN="${1:-ravenstack.online}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"

API="https://api.${DOMAIN}"
TURN="turn.${DOMAIN}"
PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

http() { curl -s -o /tmp/vd.out -w '%{http_code}' --max-time 40 "$1" 2>/dev/null; }

# Resolve against a public resolver, not the system one, which may still hold
# pre-cutover records until their TTL expires — a property of this machine,
# not of the domain.
RESOLVER="${RAVEN_DNS_RESOLVER:-1.1.1.1}"

echo "=== DNS ==="
for spec in "${DOMAIN}:A:76.76.21.21" "app.${DOMAIN}:CNAME:vercel-dns" \
            "docs.${DOMAIN}:CNAME:vercel-dns" "api.${DOMAIN}:CNAME:azurecontainerapps.io" \
            "${TURN}:A:40.83.92.152"; do
  H="${spec%%:*}"; rest="${spec#*:}"; T="${rest%%:*}"; EXP="${rest##*:}"
  got="$(dig +short "$T" "$H" "@${RESOLVER}" 2>/dev/null | tr -d '\n')"
  printf '%s' "${got}" | grep -q "${EXP}" && ok "${H} ${T} -> ${got}" || bad "${H} ${T} -> '${got}' (want ${EXP})"
done

echo "=== Frontends (HTTPS + TLS) ==="
for spec in "landing:https://${DOMAIN}" "dashboard:https://app.${DOMAIN}/login" "docs:https://docs.${DOMAIN}"; do
  N="${spec%%:*}"; U="${spec#*:}"
  C="$(http "$U")"
  [ "$C" = "200" ] && ok "${N} ${U} -> 200" || bad "${N} ${U} -> ${C}"
  # curl's ssl_verify_result is authoritative: 0 means the chain verified.
  # `openssl s_client | grep "Verify return code: 0"` is not reliable here —
  # it reports failures for hosts curl completes a verified handshake with.
  V="$(curl -s -o /dev/null -w '%{ssl_verify_result}' --max-time 40 "$U" 2>/dev/null)"
  [ "$V" = "0" ] && ok "${N} TLS chain verified" || bad "${N} TLS chain (ssl_verify_result=${V:-n/a})"
done

echo "=== API ==="
for p in /health/live /health/ready /health; do
  C="$(http "${API}${p}")"
  [ "$C" = "200" ] && ok "${API}${p} -> 200" || bad "${API}${p} -> ${C}"
done
V="$(curl -s -o /dev/null -w '%{ssl_verify_result}' --max-time 40 "${API}/health/live" 2>/dev/null)"
[ "$V" = "0" ] && ok "API TLS chain verified" || bad "API TLS chain (ssl_verify_result=${V:-n/a})"
http "${API}/health" >/dev/null
python3 - <<'PY' || true
import json
try:
    d = json.load(open('/tmp/vd.out'))
except Exception:
    print("  FAIL  /health body not JSON"); raise SystemExit
dep = d.get('dependencies', {})
for k in ('database', 'redis', 'sfu', 'turn'):
    print(f"  {'PASS' if dep.get(k) == 'up' else 'FAIL'}  dependency {k}: {dep.get(k)}")
PY

echo "=== Old Azure FQDN still serving (no migration cliff) ==="
C="$(http "https://raven-api.salmontree-6311a7e1.eastasia.azurecontainerapps.io/health/live")"
[ "$C" = "200" ] && ok "generated FQDN still 200" || bad "generated FQDN -> ${C}"

echo "=== STUN / TURN on the new hostname ==="
stun_ok=0
for _ in 1 2 3; do
  python3 "${HERE}/stun_binding.py" "${TURN}" 3478 2>/dev/null | grep -q PASS && { stun_ok=1; break; }
done
[ "$stun_ok" = "1" ] && ok "STUN binding on ${TURN}:3478" || bad "STUN binding on ${TURN}:3478 (3 attempts)"

# TCP 3478 reachability (the fallback path where UDP is blocked).
python3 - <<PY
import socket, sys
s = socket.socket(); s.settimeout(8)
try:
    s.connect(("${TURN}", 3478)); s.close(); print("  PASS  TURN over TCP 3478 open")
except Exception as e:
    print(f"  FAIL  TURN over TCP 3478: {e}")
PY

# TURNS: real TLS handshake, and the cert must match the new hostname.
# coturn speaks TURN over TLS, not HTTP, so curl cannot be used here.
# -verify_return_error makes openssl exit non-zero on a chain failure
# instead of relying on parsing its human-readable output.
if echo | openssl s_client -connect "${TURN}:5349" -servername "${TURN}" \
     -verify_return_error -verify 3 >/dev/null 2>&1; then
  ok "TURNS 5349 TLS chain verified"
else bad "TURNS 5349 TLS chain"; fi
SUBJ="$(echo | openssl s_client -connect "${TURN}:5349" -servername "${TURN}" 2>/dev/null \
        | openssl x509 -noout -subject 2>/dev/null)"
printf '%s' "${SUBJ}" | grep -q "${TURN}" \
  && ok "TURNS certificate CN matches ${TURN}" || bad "TURNS cert subject: ${SUBJ:-none}"

echo "=== TURN credentials minted by the deployed API ==="
CREDS="$(cd "${REPO_ROOT}/apps/api" && TURN_SECRET="$(az keyvault secret show --vault-name raven-kv-ea1 -n turn-secret --query value -o tsv 2>/dev/null)" node -e '
const { generateTurnCredential } = require("./dist/modules/rtc-tokens/turn-credential.util.js");
const c = generateTurnCredential(process.env.TURN_SECRET, 600, "domain-verify");
console.log(c.username + "\t" + c.credential);' 2>/dev/null)"
if [ -n "${CREDS}" ]; then
  alloc_ok=0
  for _ in 1 2 3; do
    python3 "${HERE}/turn_allocate.py" "${TURN}" 3478 "$(echo "${CREDS}" | cut -f1)" "$(echo "${CREDS}" | cut -f2)" \
      2>/dev/null | grep -q '^PASS' && { alloc_ok=1; break; }
  done
  [ "$alloc_ok" = "1" ] && ok "valid Raven credential accepted, relay on the public IP" \
                        || bad "valid Raven credential rejected (3 attempts)"
  python3 "${HERE}/turn_allocate.py" "${TURN}" 3478 "9999999999:forged" "bm90LXRoZS1zZWNyZXQ=" 2>/dev/null \
    | grep -q '^PASS' && bad "FORGED credential ACCEPTED — open relay, stop coturn now" \
                      || ok "forged credential rejected (401)"
else
  bad "could not mint a credential locally (build apps/api first?)"
fi

echo "=== RTC token advertises the new TURN hostname ==="
echo "  (needs an API key; run tests/api-e2e.sh against ${API} for the full mint path)"

echo "=== Browser must not learn the Azure hostname ==="
for U in "https://${DOMAIN}" "https://app.${DOMAIN}/login" "https://docs.${DOMAIN}"; do
  rm -f /tmp/vd.html
  curl -s --max-time 40 "$U" -o /tmp/vd.html 2>/dev/null
  if [ ! -s /tmp/vd.html ]; then
    bad "${U} returned no body — leak check inconclusive, not a pass"
    continue
  fi
  if grep -qi "azurecontainerapps.io\|pooler.supabase.com\|cloudapp.azure.com" /tmp/vd.html; then
    bad "${U} leaks an infrastructure hostname"
  else
    ok "${U} clean"
  fi
done

echo
echo "=== ${PASS} passed, ${FAIL} failed ==="
[ "${FAIL}" -eq 0 ] || exit 1
