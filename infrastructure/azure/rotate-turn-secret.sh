#!/usr/bin/env bash
# Propagate the CURRENT Key Vault turn-secret to coturn.
#
# This script does NOT generate a secret. It copies whatever version of
# turn-secret is current in Key Vault onto raven-coturn-01 and restarts
# coturn so it loads it. Generation stays in 05-secrets.sh (and that
# function deliberately never overwrites an existing secret) — rotating
# means `az keyvault secret set -n turn-secret`, then running this.
#
# Why this exists. coturn has no user database and no control channel: the
# shared secret IS the coupling between the API and the relay
# (07-deploy-coturn.sh's conf comment). 07 reads Key Vault at DEPLOY time
# and bakes the value into /opt/raven/turnserver.conf, while the API and
# 08-verify.sh read Key Vault LIVE. So a rotation moves every reader except
# the one that matters, and the two sides silently disagree:
#
#   Livqeno-minted credential -> 401       (coturn recomputes a different HMAC)
#   Forged credential       -> 401       (auth is working fine)
#
# which looks like a broken implementation and is really config drift. That
# is the whole failure this script closes. Until raven-coturn-01 has a
# managed identity with Key Vault Secrets User — it has none today, so it
# cannot fetch its own secret — propagation has to be pushed from here.
#
# Safe to run any time: it compares fingerprints first and does nothing if
# coturn already has the current version. Never prints secret material.
#
# Usage:
#   ./rotate-turn-secret.sh
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"

CONF=/opt/raven/turnserver.conf
SSH_OPTS=(-i "${RAVEN_SSH_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
TURN_PUBLIC_IP="$(az network public-ip show -g "${RAVEN_RG}" -n "${RAVEN_TURN_IP_NAME}" --query ipAddress -o tsv)"
SSH_TARGET="${RAVEN_ADMIN_USER}@${TURN_PUBLIC_IP}"

# First 12 hex of the SHA-256 of stdin. Enough to tell two 32-byte random
# secrets apart, not enough to be useful to anyone who reads the logs.
# sha256sum on Linux, shasum on macOS — this runs from an admin laptop.
sha12() {
  local h
  if command -v sha256sum >/dev/null 2>&1; then h="$(sha256sum)"; else h="$(shasum -a 256)"; fi
  printf '%s' "${h:0:12}"
}

# The same computation, run on the VM against the live config. Only the
# fingerprint comes back over the wire.
REMOTE_FP_CMD='sudo sed -n "s/^static-auth-secret=//p" '"${CONF}"' | tr -d "\n" | sha256sum | cut -c1-12'

echo "==> Key Vault ${RAVEN_KV}"
KV_ID="$(az keyvault secret show --vault-name "${RAVEN_KV}" -n turn-secret --query id -o tsv)"
KV_CREATED="$(az keyvault secret show --vault-name "${RAVEN_KV}" -n turn-secret --query attributes.created -o tsv)"
TURN_SECRET="$(az keyvault secret show --vault-name "${RAVEN_KV}" -n turn-secret --query value -o tsv)"
# -o tsv appends a newline; a trailing byte here would change the HMAC and
# produce exactly the 401 this script exists to fix.
TURN_SECRET="${TURN_SECRET%$'\n'}"
KV_FP="$(printf '%s' "${TURN_SECRET}" | sha12)"
echo "    current version ${KV_ID##*/}  created ${KV_CREATED}"
echo "    fingerprint     ${KV_FP}"

echo "==> coturn on ${TURN_PUBLIC_IP}"
if ! ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "test -f ${CONF}"; then
  echo "    FAIL: ${CONF} does not exist. This host has never been deployed —"
  echo "    run ./07-deploy-coturn.sh instead, which writes the whole config." >&2
  exit 1
fi

HAS_LINE="$(ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "sudo grep -c '^static-auth-secret=' ${CONF} || true")"
if [ "${HAS_LINE}" = "0" ]; then
  # Not drift — a config with no shared secret under use-auth-secret is an
  # open relay. Worth saying out loud rather than quietly repairing.
  echo "    WARNING: no static-auth-secret line present at all."
  echo "    coturn has been running WITHOUT a shared secret. Adding it now."
  OLD_FP="(absent)"
else
  OLD_FP="$(ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "${REMOTE_FP_CMD}")"
  echo "    fingerprint     ${OLD_FP}"
fi

if [ "${OLD_FP}" = "${KV_FP}" ]; then
  echo
  echo "==> Already current — coturn and Key Vault agree (${KV_FP}). Nothing to do."
  exit 0
fi

echo
echo "==> Updating ${CONF}  ${OLD_FP} -> ${KV_FP}"
# The secret travels on stdin, never in argv: an ssh command line is visible
# in `ps` on both ends. Everything else in the file is left exactly as it
# was — this replaces one line and touches nothing else, so a hand-tuned
# quota or peer rule survives.
#
# `tee` and not mv/cp-from-tmp on purpose: docker bind-mounts this file by
# inode, and replacing the inode would leave the container reading the old
# content. tee truncates in place.
printf '%s' "${TURN_SECRET}" | ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "
  set -eu
  umask 077
  SECRET=\"\$(cat)\"
  # || true: grep -v exits 1 when it emits nothing, which under set -e
  # would abort on a conf whose only line was the secret.
  BODY=\"\$(sudo grep -v '^static-auth-secret=' ${CONF} || true; printf 'static-auth-secret=%s\n' \"\$SECRET\")\"
  printf '%s\n' \"\$BODY\" | sudo tee ${CONF} >/dev/null
  sudo chown 65534:65534 ${CONF}
  sudo chmod 600 ${CONF}
"

# coturn reads its config once, at start. --force-recreate rather than
# restart for the inode reason above, and because it is the path
# 07-deploy-coturn.sh already proves works.
echo "==> Restarting coturn"
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" \
  "cd /opt/raven && docker compose up -d --force-recreate && sleep 6 && docker ps --filter name=raven-coturn --format 'table {{.Names}}\t{{.Status}}'"

# ---------------------------------------------------------------------------
# Assert. Three checks, because "the container is up" proves nothing here.
# ---------------------------------------------------------------------------
TURN_REALM="${RAVEN_TURN_REALM:-${TURN_PUBLIC_IP}}"

# 1. The config was READ. coturn does not die on an unreadable config file:
#    it warns and runs on defaults, which means no realm and NO AUTH. A 600
#    file owned by the wrong uid reproduces that exactly, and this script
#    just rewrote the ownership — so re-prove it, same as 07 does.
echo "==> Verifying the config took effect"
if ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" \
     "docker logs raven-coturn 2>&1 | grep -q 'Default realm: ${TURN_REALM}'"; then
  echo "    realm ${TURN_REALM} loaded"
else
  echo "    FAIL: coturn did not load ${TURN_REALM} as its realm — it is"
  echo "    probably running on defaults with NO AUTH." >&2
  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "cd /opt/raven && docker compose stop" || true
  echo "    coturn stopped so it is not left exposed." >&2
  exit 1
fi

# 2. The file on disk is now the Key Vault version.
NEW_FP="$(ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "${REMOTE_FP_CMD}")"
if [ "${NEW_FP}" = "${KV_FP}" ]; then
  echo "    fingerprint ${NEW_FP} matches Key Vault"
else
  echo "    FAIL: coturn fingerprint ${NEW_FP} still differs from Key Vault ${KV_FP}." >&2
  exit 1
fi

# 3. The only check that actually matters: a real Allocate with a credential
#    minted the way the API mints it. Fingerprints agreeing on disk is not
#    the same as coturn authorizing with them.
if [ ! -f "${REPO_ROOT}/apps/api/dist/modules/rtc-tokens/turn-credential.util.js" ]; then
  echo "    SKIP live Allocate: apps/api/dist is not built."
  echo "    Run 'pnpm --filter @raven/api build', then ./08-verify.sh." >&2
  exit 0
fi
CREDS="$(cd "${REPO_ROOT}/apps/api" && TURN_SECRET="${TURN_SECRET}" node -e '
const { generateTurnCredential } = require("./dist/modules/rtc-tokens/turn-credential.util.js");
const c = generateTurnCredential(process.env.TURN_SECRET, 600, "rotate-verify");
console.log(c.username + "\t" + c.credential);')"
if python3 "${HERE}/tests/turn_allocate.py" "${TURN_PUBLIC_IP}" "${RAVEN_TURN_PORT}" \
     "$(echo "${CREDS}" | cut -f1)" "$(echo "${CREDS}" | cut -f2)" | grep -q "^PASS"; then
  echo "    live Allocate with a Livqeno-minted credential: PASS"
else
  echo "    FAIL: coturn still rejects a Livqeno-minted credential." >&2
  echo "    Fingerprints match, so this is no longer a secret mismatch —" >&2
  echo "    check the realm and 'docker logs raven-coturn' for check_stun_auth." >&2
  exit 1
fi

echo
echo "==> Done. Key Vault, Livqeno and coturn all on ${KV_FP}."
echo "    Confirm the full suite with: ./08-verify.sh"
