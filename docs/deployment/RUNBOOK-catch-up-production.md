# Runbook — bringing production up to `main`

Written 2026-09-09, after `app.ravenstack.online` was found serving a build
from before the free-tier-usage-metering merge.

**Both halves have now been run** (2026-09-09) — see "Done" below. What is
left is one thing no script can do: registering OAuth credentials for
production. The commands are kept here because they are the deploy path
for every future release, not just this catch-up.

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

## Done

**Dashboard** — deployed from a tree identical to `origin/main`
(`vercel deploy --prod`); `app.ravenstack.online` is aliased to it.

**API** — image `ravenacr.azurecr.io/raven-api:0f14ad1` built and pushed
(previous was `201b545`), the migration job run against production, and
revision `raven-api--0000003` rolled out with 100% of traffic. Verified
after:

| | Before | After |
|---|---|---|
| Documented routes | 78 paths | 91 paths / 114 routes |
| `oauth` / `usage` / `onboarding` | absent | all present |
| `/v1/auth/oauth/providers` | `404` | `200` |
| `/v1/usage` | `404` | `401` (present, auth-guarded) |

Migrations: `prisma migrate status` reports "up to date". The backfill
landed correctly — 2 users, 2 allowances, both at 20,000 minutes, 0
sessions, RLS on 30/30 tables.

Rollback if ever needed: revisions `--0000001` and `--0000002` are still
Running and traffic-free (the app is in `Multiple` revision mode weighted
100% to latest), so traffic can be shifted back without a rebuild.

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

### 2. Configure OAuth on the production API — needs you

The "Can't reach the Livqeno API" notice is gone, but the GitHub and Google
buttons still do not appear, and that is now correct rather than broken:
`/v1/auth/oauth/providers` answers `{"github":false,"google":false}`.
`configuration.ts` derives `enabled` from `Boolean(process.env.GITHUB_CLIENT_ID)`,
and the Container App has no OAuth variables at all — Key Vault holds nine
secrets, none of them OAuth.

This needs credentials handled by a person, in provider consoles:

1. **Register production callback URLs.** The local credentials in `.env`
   point at `localhost:3001` and cannot be reused as they are. A GitHub
   OAuth App accepts only one callback URL, so production needs its own
   app; Google accepts several redirect URIs, so one app can serve both.
   The URL in both cases is
   `https://app.ravenstack.online/api/auth/oauth/{github|google}/callback`.
2. **Store them** as Key Vault secrets alongside the existing nine, e.g.
   `github-client-id`, `github-client-secret`, `google-client-id`,
   `google-client-secret`.
3. **Wire them into the app**, plus `APP_URL=https://app.ravenstack.online`
   so `callbackUrl` derives correctly instead of falling back to
   `http://localhost:3000`. Add them to `13-api-app.sh`'s spec next to
   `JWT_SECRET` so the next revision keeps them.

Until then, email + password sign-in works and the OAuth buttons stay
hidden — which is the honest rendering of a deployment without OAuth
configured.

Note also absent from the running revision, if they matter later: email
(`RESEND_*`), storage (`STORAGE_*`), and every `USAGE_*` variable. The
last one is deliberate — `configuration.ts` defaults to 20,000 minutes
with enforcement on, so metering is live without any of them set.

### 3. The deploy path, for future releases

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
#    Applies whatever is pending — see the note below.
./12-migrate-job.sh
az containerapp job start -n raven-migrate -g "$RAVEN_RG"
az containerapp job execution list -n raven-migrate -g "$RAVEN_RG" -o table

# c. New app revision; the previous one is kept for rollback.
./13-api-app.sh
```

#### Before running (b): check what is pending, every time

Run `prisma migrate status` against production first and read the list.
For the 2026-09-09 catch-up it was these three (all now applied), which is
the shape to expect — mostly no-ops, with one that writes data:

| Migration | Effect |
|---|---|
| `20260908999999_ensure_data_api_roles` | No-op here — all three Supabase roles already exist. |
| `20260909120000_add_usage_metering` | Creates `usage_allowances` + `usage_sessions`, and **backfills one allowance per existing user at 20,000 minutes**. One row per account. |
| `20260909130000_portable_data_api_lockdown` | Re-asserts the RLS lockdown across every table, and rebinds the default-privileges revoke to `current_user`. Idempotent; verified as a no-op where the state is already correct. |

The backfill was the only one that wrote application data. It is
`ON CONFLICT DO NOTHING`, so re-running is safe, and it grants rather than
revokes — no existing account loses anything. It landed as expected: 2
users, 2 allowances, both 20,000 minutes.

Verified on a clean cluster with `POSTGRES_USER=raven` (CI-identical) and
on one seeded to look like Supabase: 30 tables, 30 with RLS, 30 with the
`service_role` policy, 0 residual `anon`/`authenticated` grants.

#### Verify after

```bash
curl -s https://api.ravenstack.online/health | jq
# 91 paths / 114 routes as of 0f14ad1, with oauth/usage/onboarding present:
curl -s https://api.ravenstack.online/docs-json \
  | jq '[.paths | keys[]] | length, (map(select(test("oauth|usage|onboarding"))))'
curl -s https://api.ravenstack.online/v1/auth/oauth/providers   # {"github":true,"google":true}
```

Then reload https://app.ravenstack.online/login. The "Can't reach the
Livqeno API" notice disappearing is the signal that both halves are current.
The provider buttons appearing is a *separate* signal, and needs step 2 —
without OAuth credentials the page correctly shows neither the notice nor
the buttons.

**Rollback**: `infrastructure/azure/README.md` → "Rollback". `13-api-app.sh`
keeps the previous revision, so the app can be pointed back at it.
Migrations are not rolled back, and do not need to be — the new tables are
additive and nothing older reads them.

### 4. Ordering, for next time

Ship the API before or with the dashboard. The reverse also works — a
dashboard ahead of its API degrades to an explicit "can't reach the API"
notice rather than breaking — but it puts that notice in front of users
for the gap.

Once step 1 is done, be aware that a push to `main` will auto-deploy all
three Vercel projects while the API still needs its scripts run by hand.
That asymmetry is worth remembering: the dashboard will race ahead of the
API on every release until the API deploy is automated too.
