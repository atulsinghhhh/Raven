#!/usr/bin/env bash
# Key Vault + production secrets.
#
# Secrets are GENERATED HERE and written straight to Key Vault. They are
# never echoed, never written to a file in the repo, and never committed.
# Re-running this script does not rotate anything: each secret is only
# created if absent, so it is safe to re-run after adding a new one.
#
# Four of these must be mutually distinct or the API refuses to boot in
# production (apps/api/src/shared/config/env.validation.ts): JWT_SECRET,
# RTC_TOKEN_SECRET, CHAT_TOKEN_SECRET, and SFU_REGISTRATION_SECRET. A leak
# of any one must not be able to mint the others.
set -euo pipefail
source "$(dirname "$0")/00-variables.sh"

echo "==> Key Vault ${RAVEN_KV}"
if az keyvault show -n "${RAVEN_KV}" -g "${RAVEN_RG}" --output none 2>/dev/null; then
  echo "    already exists"
else
  # Access policies rather than RBAC: the creating principal is granted
  # secret access immediately, with no role-assignment propagation delay.
  az keyvault create \
    --name "${RAVEN_KV}" --resource-group "${RAVEN_RG}" \
    --location "${RAVEN_LOCATION}" \
    --enable-rbac-authorization false \
    --retention-days 7 \
    --output none
  echo "    created"
fi

# set_generated <secret-name> — 32 random bytes, hex. Only if absent.
set_generated() {
  local name="$1"
  if az keyvault secret show --vault-name "${RAVEN_KV}" -n "${name}" --output none 2>/dev/null; then
    echo "    = ${name} (exists, left alone)"
    return
  fi
  az keyvault secret set --vault-name "${RAVEN_KV}" -n "${name}" \
    --value "$(openssl rand -hex 32)" --output none
  echo "    + ${name} (generated)"
}

# set_literal <secret-name> <value> — for values that come from elsewhere
# (Supabase hands us the connection strings; we do not invent them).
set_literal() {
  local name="$1" value="$2"
  if az keyvault secret show --vault-name "${RAVEN_KV}" -n "${name}" --output none 2>/dev/null; then
    echo "    = ${name} (exists, left alone)"
    return
  fi
  az keyvault secret set --vault-name "${RAVEN_KV}" -n "${name}" \
    --value "${value}" --output none
  echo "    + ${name} (stored)"
}

echo "==> Generated secrets"
set_generated jwt-secret
set_generated rtc-token-secret
set_generated chat-token-secret
set_generated api-key-hash-secret
set_generated sfu-registration-secret
set_generated turn-secret
set_generated redis-password
# Live Streaming broadcast redesign: shared bearer secret between the API
# and the standalone egress-worker Container App. Additive — nothing
# existing rotated.
set_generated egress-worker-shared-secret

# The Supabase strings live in the operator's local .env (gitignored). They
# are copied into Key Vault so the Phase 3 Container App has one source of
# truth and no human has to paste them into a portal field.
echo "==> Supabase connection strings (from local .env, not generated)"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "${REPO_ROOT}/.env" ]; then
  DB_URL="$(grep -E '^DATABASE_URL=' "${REPO_ROOT}/.env" | head -1 | cut -d= -f2-)"
  DIR_URL="$(grep -E '^DIRECT_URL=' "${REPO_ROOT}/.env" | head -1 | cut -d= -f2-)"
  [ -n "${DB_URL}" ]  && set_literal database-url "${DB_URL}"
  [ -n "${DIR_URL}" ] && set_literal direct-url "${DIR_URL}"
else
  echo "    !! no .env found — set database-url / direct-url manually:"
  echo "       az keyvault secret set --vault-name ${RAVEN_KV} -n database-url --value '<string>'"
fi

# OAuth sign-in credentials. Deliberately NOT read from the operator's local
# .env: those GITHUB_CLIENT_ID/GOOGLE_CLIENT_ID values are registered
# against a localhost callback (docs/deployment/livqeno-domain-cutover.md
# §4) and silently reusing them here would make the API boot looking
# configured while every real sign-in attempt fails on a callback mismatch
# — worse than the buttons just not appearing. Production needs its own
# provider-console registration, so these come from dedicated env vars the
# operator exports right before running this script, once, after doing
# that registration.
echo "==> OAuth sign-in (from PROD_* env vars — not generated, not from local .env)"
if [ -n "${PROD_GITHUB_CLIENT_ID:-}" ] && [ -n "${PROD_GITHUB_CLIENT_SECRET:-}" ]; then
  set_literal github-client-id "${PROD_GITHUB_CLIENT_ID}"
  set_literal github-client-secret "${PROD_GITHUB_CLIENT_SECRET}"
else
  echo "    -- GitHub OAuth skipped: PROD_GITHUB_CLIENT_ID / PROD_GITHUB_CLIENT_SECRET not set"
fi
if [ -n "${PROD_GOOGLE_CLIENT_ID:-}" ] && [ -n "${PROD_GOOGLE_CLIENT_SECRET:-}" ]; then
  set_literal google-client-id "${PROD_GOOGLE_CLIENT_ID}"
  set_literal google-client-secret "${PROD_GOOGLE_CLIENT_SECRET}"
else
  echo "    -- Google OAuth skipped: PROD_GOOGLE_CLIENT_ID / PROD_GOOGLE_CLIENT_SECRET not set"
fi

echo "==> Vault contents (names only)"
az keyvault secret list --vault-name "${RAVEN_KV}" --query "sort_by([].{name:name}, &name)" -o table
