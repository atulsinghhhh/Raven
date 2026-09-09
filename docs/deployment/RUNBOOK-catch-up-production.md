# Runbook — bringing production up to `main`

Written 2026-09-09, after `app.ravenstack.online` was found serving a build
from before the free-tier-usage-metering merge.

**Nothing in here has been run.** The dashboard half was done; the API half
is written up deliberately, because it deploys a live release *and* runs
three migrations against the production database.

## What was wrong

| | |
|---|---|
| **Dashboard** | No Git repo connected to the `raven-dashboard` Vercel project (`link: null`, same for `raven-docs` and `raven-landing`). Vercel was not watching GitHub, so a push to `main` could not trigger anything. Every deployment had been a manual `vercel deploy`. |
| **API** | `api.ravenstack.online` is healthy but running a much older image: its OpenAPI spec exposes 78 paths with **no** `oauth`, `usage` or `onboarding` routes. `main` has 117. |

The second one is why the live login page had no GitHub/Google buttons:
the dashboard calls `GET /v1/auth/oauth/providers`, the deployed API 404s,
and the page treated that as "no providers configured". It now says so
explicitly instead (`AuthApiUnreachable`) — which is what the live site
shows today, correctly, until the API catches up.

## Done already

`raven-dashboard` was deployed to production from a tree identical to
`origin/main` (`vercel deploy --prod`), and `app.ravenstack.online` is
aliased to it.

## Still to do

### 1. Connect GitHub to Vercel — needs you, in a browser

This is the actual fix for "I pushed and nothing deployed", and it cannot
be scripted. Both routes fail today:

```
$ vercel git connect https://github.com/atulsinghhhh/Raven
Error: Failed to parse URL "git@github-atulsinghhhh:atulsinghhhh/Raven.git"
```

The CLI reads the `origin` remote and cannot parse the custom SSH host
alias `github-atulsinghhhh`. Going straight at the API gets to the real
blocker:

```
POST /v9/projects/prj_i8U7.../link  {"type":"github","repo":"atulsinghhhh/Raven"}
→ bad_request: You need to add a Login Connection to your GitHub account first.
```

The Vercel account `atulsinghh` has no GitHub login connection, so no
project under it can be linked to a GitHub repo. Fix it once, in the
browser:

1. https://vercel.com/account/login-connections → connect GitHub.
2. Then, per project → Settings → Git → **Connect Git Repository** →
   `atulsinghhhh/Raven`.
   Repeat for `raven-dashboard`, `raven-docs`, `raven-landing`. Root
   directories are already set (`apps/dashboard`, `apps/docs`, `apps/www`)
   and must not change.
3. Set the production branch to `main`.

Once connected, `vercel git connect` will also start working from a clone
whose `origin` is an ordinary URL. To make the CLI usable here without
waiting, give the repo a parseable remote:

```bash
git remote set-url origin https://github.com/atulsinghhhh/Raven.git
# or keep SSH and add:  git remote add vercel https://github.com/atulsinghhhh/Raven.git
```

**Check afterwards** — a Git-connected project reports its link, and a
Git-triggered deployment carries commit metadata that a CLI upload does
not:

```bash
vercel project inspect raven-dashboard
vercel ls raven-dashboard          # source should stop being your username
```

### 2. Deploy the API — a live release plus a production migration

Read `infrastructure/azure/README.md` first; the scripts are numbered and
assume `00-variables.sh` is sourced. All three take `RAVEN_IMAGE_TAG`,
defaulting to `git rev-parse --short HEAD` for the build and `latest` for
the deploy — **pin it explicitly** so the image, the migration job and the
app revision are provably the same build.

```bash
cd infrastructure/azure
az login
az account set --subscription "<subscription>"

export RAVEN_IMAGE_TAG="$(git rev-parse --short origin/main)"

# a. Build linux/amd64 from the repo root and push to ACR.
./09-api-image.sh

# b. Point the migration job at that tag and run it.
#    Applies the 3 pending migrations — see the warning below.
./12-migrate-job.sh
az containerapp job start -n raven-migrate -g "$RAVEN_RG"
az containerapp job execution list -n raven-migrate -g "$RAVEN_RG" -o table

# c. New app revision; the previous one is kept for rollback.
./13-api-app.sh
```

#### Before running (b): what those migrations do

Checked against production on 2026-09-09 — `prisma migrate status` reports
exactly three pending. `20260909000000_enable_row_level_security` is
already applied and will not be re-run; its guard fix is therefore
cosmetic on this database and matters only for fresh ones (CI, scratch).

| Migration | Effect |
|---|---|
| `20260908999999_ensure_data_api_roles` | No-op here — all three Supabase roles already exist. |
| `20260909120000_add_usage_metering` | Creates `usage_allowances` + `usage_sessions`, and **backfills one allowance per existing user at 20,000 minutes**. One row per account. |
| `20260909130000_portable_data_api_lockdown` | Re-asserts the RLS lockdown across every table, and rebinds the default-privileges revoke to `current_user`. Idempotent; verified as a no-op where the state is already correct. |

The backfill is the only one that writes application data. It is
`ON CONFLICT DO NOTHING`, so re-running is safe, and it grants rather than
revokes — no existing account loses anything.

Verified on a clean cluster with `POSTGRES_USER=raven` (CI-identical) and
on one seeded to look like Supabase: 30 tables, 30 with RLS, 30 with the
`service_role` policy, 0 residual `anon`/`authenticated` grants.

#### Verify after

```bash
curl -s https://api.ravenstack.online/health | jq
# 117-ish paths, and oauth/usage/onboarding present:
curl -s https://api.ravenstack.online/docs-json \
  | jq '[.paths | keys[]] | length, (map(select(test("oauth|usage|onboarding"))))'
curl -s https://api.ravenstack.online/v1/auth/oauth/providers   # {"github":true,"google":true}
```

Then reload https://app.ravenstack.online/login — the "Can't reach the
Raven API" notice should be replaced by the two provider buttons. That is
the end-to-end signal that both halves are current.

**Rollback**: `infrastructure/azure/README.md` → "Rollback". `13-api-app.sh`
keeps the previous revision, so the app can be pointed back at it.
Migrations are not rolled back, and do not need to be — the new tables are
additive and nothing older reads them.

### 3. Ordering

The dashboard is already ahead of the API, which is the safe direction: it
degrades to an explicit "can't reach the API" notice rather than breaking.
Deploy the API whenever you like; nothing is waiting on it except the OAuth
buttons and the usage page.

If you connect Git (step 1) **before** deploying the API, be aware the next
push to `main` will auto-deploy all three Vercel projects. That is the point
of it, but it is a behaviour change worth knowing about in advance.
