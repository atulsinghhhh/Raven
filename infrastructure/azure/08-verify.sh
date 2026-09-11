#!/usr/bin/env bash
# Phase 2 acceptance tests. Read-only: creates nothing, changes nothing.
#
# Every check here is a real protocol exchange or a real socket probe, not a
# reading of the Azure config that produced it — the whole point is to catch
# the case where the declared configuration and the running behaviour differ.
# The open-relay bug this suite was written after (a config file coturn could
# not read, so it ran with no auth while looking healthy) is exactly that case.
set -uo pipefail
source "$(dirname "$0")/00-variables.sh"
# 00-variables.sh ends with `set -euo pipefail`, which re-enables -e and
# undoes the deliberate omission on the line above. This suite must NOT exit
# on the first failing command: a check that fails has to record a FAIL and
# let the rest run. The `if ssh ...` checks below happen to survive -e (it
# does not apply to an if condition), which is what made this silent — the
# first BARE failing command, the UDP probe's ssh, aborted the whole run and
# skipped STUN, TURN and the port checks with no summary at all.
set +e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"

PASS=0; FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# First 12 hex of SHA-256 of stdin. Used only to COMPARE secrets in the TURN
# diagnostics below — enough to tell two 32-byte random values apart, useless
# to anyone reading the output. sha256sum on Linux, shasum on macOS.
sha12() {
  local h
  if command -v sha256sum >/dev/null 2>&1; then h="$(sha256sum)"; else h="$(shasum -a 256)"; fi
  printf '%s' "${h:0:12}"
}

SSH_OPTS=(-i "${RAVEN_SSH_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
SFU_IP="$(az network public-ip show -g "${RAVEN_RG}" -n "${RAVEN_SFU_IP_NAME}" --query ipAddress -o tsv)"
TURN_IP="$(az network public-ip show -g "${RAVEN_RG}" -n "${RAVEN_TURN_IP_NAME}" --query ipAddress -o tsv)"
SFU_PRIV="$(az vm show -g "${RAVEN_RG}" -n "${RAVEN_SFU_VM}" -d --query privateIps -o tsv)"

echo "=== Redis ==="
if ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${SFU_IP}" \
     'docker exec raven-redis redis-cli -a "$(grep ^REDIS_PASSWORD= /opt/raven/.env | cut -d= -f2-)" ping 2>/dev/null' \
     | grep -q PONG; then ok "PING -> PONG"; else bad "PING"; fi

echo "=== SFU ==="
if ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${SFU_IP}" \
     'curl -sf http://localhost:7000/healthz' | grep -q '"status":"ok"'; then
  ok "/healthz -> status ok"; else bad "/healthz"; fi

# The check that matters most: an Azure VM cannot see its own public IP, so
# a node that advertises its NIC address still looks healthy while every call
# it serves silently relays through TURN.
if ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${SFU_IP}" \
     "grep -q '^SFU_PUBLIC_IP=${SFU_IP}$' /opt/raven/.env"; then
  ok "SFU_PUBLIC_IP is the static public IP (${SFU_IP}), not the NIC (${SFU_PRIV})"
else bad "SFU_PUBLIC_IP is not the public IP — ICE would advertise an unroutable address"; fi

# Media range reachability, proven with a packet rather than inferred from
# the NSG. Pion binds media sockets per ICE session, so nothing listens on
# the range at idle and a port scan would wrongly report it shut.
ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${SFU_IP}" "cat > /tmp/udp-probe.py <<'PY'
import socket,sys
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(('0.0.0.0',int(sys.argv[1]))); s.settimeout(25)
try:
    d,a=s.recvfrom(2048); open('/tmp/udp-result','w').write('OK')
except socket.timeout: open('/tmp/udp-result','w').write('TIMEOUT')
PY
rm -f /tmp/udp-result; nohup python3 /tmp/udp-probe.py ${RAVEN_SFU_UDP_MIN} >/dev/null 2>&1 &" >/dev/null 2>&1
sleep 3
python3 -c "
import socket
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
for _ in range(3): s.sendto(b'probe', ('${SFU_IP}', ${RAVEN_SFU_UDP_MIN}))
" 2>/dev/null
sleep 4
if ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${SFU_IP}" 'cat /tmp/udp-result 2>/dev/null' | grep -q OK; then
  ok "UDP ${RAVEN_SFU_UDP_MIN} reachable from the Internet (media range open)"
else bad "UDP ${RAVEN_SFU_UDP_MIN} not reachable — check NSG AllowSfuMediaUdp"; fi
ssh "${SSH_OPTS[@]}" "${RAVEN_ADMIN_USER}@${SFU_IP}" 'rm -f /tmp/udp-probe.py /tmp/udp-result' >/dev/null 2>&1

echo "=== STUN ==="
if python3 "${HERE}/tests/stun_binding.py" "${TURN_IP}" "${RAVEN_TURN_PORT}" | grep -q PASS; then
  ok "Binding request -> success, XOR-MAPPED-ADDRESS returned"
else bad "STUN binding"; fi

echo "=== TURN ==="
TURN_SECRET="$(az keyvault secret show --vault-name "${RAVEN_KV}" -n turn-secret --query value -o tsv)"
CREDS="$(cd "${REPO_ROOT}/apps/api" && TURN_SECRET="${TURN_SECRET}" node -e '
const { generateTurnCredential } = require("./dist/modules/rtc-tokens/turn-credential.util.js");
const c = generateTurnCredential(process.env.TURN_SECRET, 600, "phase2-verify");
console.log(c.username + "\t" + c.credential);')"
# Why this failure gets its own diagnostics: it reads as a broken credential
# implementation and is almost always config drift. 07-deploy-coturn.sh bakes
# the secret into /opt/raven/turnserver.conf at DEPLOY time; the line above
# reads Key Vault LIVE. Rotate the secret and every reader moves except
# coturn, so Livqeno-minted credentials start getting 401 while the forged
# control below still passes — auth is working, the two sides just disagree
# about the key. Naming that costs three commands; guessing at it costs an
# afternoon in turn-credential.util.ts, which is not where the bug is.
#
# Fingerprints only. Never the secret.
turn_diagnostics() {
  echo "        --- diagnosis -------------------------------------------"
  if [ -z "${CREDS}" ]; then
    echo "        No credential was minted at all: apps/api/dist is missing or"
    echo "        stale. Run: pnpm --filter @raven/api build"
    echo "        ---------------------------------------------------------"
    return
  fi

  local kv_id kv_created kv_fp remote_fp conf_mtime
  kv_id="$(az keyvault secret show --vault-name "${RAVEN_KV}" -n turn-secret --query id -o tsv 2>/dev/null)"
  kv_created="$(az keyvault secret show --vault-name "${RAVEN_KV}" -n turn-secret --query attributes.created -o tsv 2>/dev/null)"
  kv_fp="$(printf '%s' "${TURN_SECRET}" | sha12)"
  echo "        Key Vault  version ${kv_id##*/}"
  echo "                   created ${kv_created}"
  echo "                   secret  ${kv_fp}  (sha256, first 12)"

  # Computed on the VM so the secret never crosses the wire. Short timeout:
  # SSH is admin-IP-restricted and a blocked NSG must not stall the suite.
  local diag_ssh=(-i "${RAVEN_SSH_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o BatchMode=yes)
  remote_fp="$(ssh "${diag_ssh[@]}" "${RAVEN_ADMIN_USER}@${TURN_IP}" \
    'sudo sed -n "s/^static-auth-secret=//p" /opt/raven/turnserver.conf | tr -d "\n" | sha256sum | cut -c1-12' 2>/dev/null)"
  if [ -z "${remote_fp}" ]; then
    echo "        coturn     unreachable over SSH from this host, so its secret"
    echo "                   could not be fingerprinted. Either run this from the"
    echo "                   admin address in AllowSshFromAdmin, or compare with:"
    echo "                     az vm run-command invoke -g ${RAVEN_RG} -n ${RAVEN_TURN_VM} \\"
    echo "                       --command-id RunShellScript --scripts \\"
    echo "                       'sudo sed -n \"s/^static-auth-secret=//p\" /opt/raven/turnserver.conf \\"
    echo "                          | tr -d \"\\n\" | sha256sum | cut -c1-12' \\"
    echo "                       --query \"value[0].message\" -o tsv"
    echo "        ---------------------------------------------------------"
    return
  fi
  conf_mtime="$(ssh "${diag_ssh[@]}" "${RAVEN_ADMIN_USER}@${TURN_IP}" \
    'sudo stat -c %y /opt/raven/turnserver.conf' 2>/dev/null)"
  echo "        coturn     secret  ${remote_fp}"
  echo "                   conf written ${conf_mtime}"

  if [ "${kv_fp}" = "${remote_fp}" ]; then
    echo "        VERDICT    secrets MATCH — this is not secret drift. Check the"
    echo "                   realm, then 'docker logs raven-coturn' for"
    echo "                   check_stun_auth, and clock skew on this host."
  else
    echo "        VERDICT    secrets DIFFER — coturn is running an older version"
    echo "                   than Key Vault holds. Fix with:"
    echo "                     ./rotate-turn-secret.sh"
  fi
  echo "        ---------------------------------------------------------"
}

if python3 "${HERE}/tests/turn_allocate.py" "${TURN_IP}" "${RAVEN_TURN_PORT}" \
     "$(echo "${CREDS}" | cut -f1)" "$(echo "${CREDS}" | cut -f2)" | grep -q "^PASS"; then
  ok "Allocate with a credential from Livqeno's generateTurnCredential() -> relay on the public IP"
else
  bad "TURN allocate with a Livqeno-minted credential"
  turn_diagnostics
fi

# The control that would have caught the open relay.
if python3 "${HERE}/tests/turn_allocate.py" "${TURN_IP}" "${RAVEN_TURN_PORT}" \
     "9999999999:forged" "bm90LXRoZS1zZWNyZXQ=" 2>/dev/null | grep -q "^PASS"; then
  bad "A FORGED credential was accepted — coturn is an open relay, stop it now"
else ok "Forged credential rejected (401) — the shared secret is genuinely enforced"; fi

echo "=== Ports that must NOT be public ==="
python3 - <<PY
import socket, sys
checks = [
    ("${SFU_IP}",  ${RAVEN_SFU_HTTP_PORT}, "SFU control"),
    ("${SFU_IP}",  ${RAVEN_REDIS_PORT},    "Redis"),
    ("${TURN_IP}", ${RAVEN_TURN_METRICS_PORT}, "coturn metrics"),
]
bad = 0
for host, port, label in checks:
    s = socket.socket(); s.settimeout(6)
    try:
        s.connect((host, port)); s.close()
        print(f"  FAIL  {label} is reachable on {host}:{port}"); bad += 1
    except Exception:
        print(f"  PASS  {label} closed from the Internet ({host}:{port})")
sys.exit(bad)
PY
if [ $? -eq 0 ]; then PASS=$((PASS+3)); else FAIL=$((FAIL+1)); fi

echo
echo "=== ${PASS} passed, ${FAIL} failed ==="
[ "${FAIL}" -eq 0 ] || exit 1
