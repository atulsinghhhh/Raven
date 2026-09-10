# Cutting over to `livqeno.com`

The repository has been rebranded from Raven to **Livqeno**. Everything a
user reads now says Livqeno; everything a machine depends on still says
raven. This document covers the second half of the migration — the part
that cannot be done from the repository, because it lives in DNS, in
Vercel, in Resend, and in two OAuth consoles.

Nothing here has been performed. The code as committed keeps pointing at
the hosts that resolve **today**, so production is unaffected until
somebody works through this list deliberately.

> **No Azure resource is renamed or recreated by any step below.** The
> resource group, Container App, ACR, coturn VM, Redis, Key Vault and the
> `ravenstack.online` DNS zone all stay exactly as they are. The only
> Azure-side change contemplated is *adding* records to a *new* zone, and
> even that is optional (see §1).

## 0. Order matters

Each step assumes the ones above it are done. Doing them out of order —
particularly flipping `APP_URL` before the OAuth redirect URIs exist — is
what breaks sign-in.

1. DNS for `livqeno.com`
2. Vercel custom domains
3. Frontend `NEXT_PUBLIC_*` env vars
4. OAuth provider redirect URIs, then `APP_URL`
5. CORS allowlist
6. Email sending domain
7. Optional: `api.livqeno.com`
8. Retire the old hostnames

## 1. DNS for `livqeno.com`

`livqeno.com` is not in any zone this repository knows about. Two ways to
host it; pick one before touching Vercel.

**Option A — keep DNS at the registrar.** Simplest. Point records straight
at Vercel. Nothing Azure-side happens at all.

**Option B — a second Azure DNS zone.** Mirrors how `ravenstack.online` is
served (zone in resource group `raven-production`). This *creates* a new
zone; it does not modify the existing one.

```bash
# Option B only. Creates a NEW zone — does not touch ravenstack.online.
az network dns zone create -g raven-production -n livqeno.com
```

Then point the registrar's nameservers at the four `ns*-*.azure-dns.*`
hosts the command prints, and wait for propagation.

Records needed either way, for the three Vercel-hosted hosts:

| Name | Type | Value |
|---|---|---|
| `@` | `A` | `76.76.21.21` |
| `www` | `CNAME` | `cname.vercel-dns.com` |
| `app` | `CNAME` | `cname.vercel-dns.com` |
| `docs` | `CNAME` | `cname.vercel-dns.com` |

Confirm Vercel's current apex target in the dashboard before trusting the
`A` record above — Vercel has changed it before.

```bash
dig @1.1.1.1 +short livqeno.com
dig @1.1.1.1 +short app.livqeno.com
dig @1.1.1.1 +short docs.livqeno.com
```

## 2. Vercel custom domains

Add the new domains to the **existing** projects. Do not create new Vercel
projects and do not rename the current ones — the project names are
`raven-landing`, `raven-dashboard`, `raven-docs` and they are referenced by
`infrastructure/azure/14-custom-domains.sh` and by the deploy workflows.

| Project (unchanged) | Add | Already has |
|---|---|---|
| `raven-landing` | `livqeno.com`, `www.livqeno.com` | `ravenstack.online`, `www` |
| `raven-dashboard` | `app.livqeno.com` | `app.ravenstack.online` |
| `raven-docs` | `docs.livqeno.com` | `docs.ravenstack.online` |

Keep both domains attached for the whole migration. Vercel serves several
domains per project and issues certificates automatically once DNS
resolves. Set `livqeno.com` as the project's primary domain only after §3
and §4 are done, so the redirect doesn't land users on a site whose links
still point at the old host.

## 3. Frontend environment variables

These are inlined at build time, so **each change needs a redeploy** — an
env edit alone does nothing.

`raven-landing`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://livqeno.com` |
| `NEXT_PUBLIC_DASHBOARD_URL` | `https://app.livqeno.com` |
| `NEXT_PUBLIC_DOCS_URL` | `https://docs.livqeno.com` |

`NEXT_PUBLIC_SITE_URL` is new in this rebrand and feeds `metadataBase` and
the canonical link (`apps/www/src/lib/site.ts`). Until it is set, the
landing page's canonical falls back to `https://ravenstack.online`, which
is correct today and wrong the moment §8 is done — so set it in the same
pass as §2.

`raven-dashboard`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_DOCS_URL` | `https://docs.livqeno.com` |
| `NEXT_PUBLIC_SUPPORT_URL` | leave unset unless support moves off GitHub issues |

`raven-docs`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_DOCS_URL` | `https://docs.livqeno.com` |
| `NEXT_PUBLIC_WWW_URL` | `https://livqeno.com` |
| `NEXT_PUBLIC_DASHBOARD_URL` | `https://app.livqeno.com` |

Leave `RAVEN_API_URL` alone on every project. It is an internal variable
name and its value (`https://api.ravenstack.online`) is the backend that
actually answers — see §7.

## 4. OAuth: providers first, then `APP_URL`

The API derives both callback URLs from `APP_URL` unless
`GITHUB_CALLBACK_URL` / `GOOGLE_CALLBACK_URL` override it
(`apps/api/src/shared/config/configuration.ts`). So the provider consoles
have to accept the new callback *before* `APP_URL` starts producing it.

**GitHub** — Settings → Developer settings → OAuth Apps → the Livqeno app.
GitHub allows exactly one callback URL per app, which is the awkward part:

- Either add a **second OAuth app** for `app.livqeno.com` and switch
  `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` at the same moment as
  `APP_URL`, or
- accept a brief window where GitHub sign-in is broken while the single
  callback is edited from
  `https://app.ravenstack.online/api/auth/oauth/github/callback` to
  `https://app.livqeno.com/api/auth/oauth/github/callback`.

The two-app route is the only zero-downtime option.

**Google** — Cloud Console → APIs & Services → Credentials → the OAuth
2.0 Client. Google permits multiple redirect URIs, so simply add:

```
https://app.livqeno.com/api/auth/oauth/google/callback
```

and keep the `app.ravenstack.online` one until §8. Also update
**Authorized JavaScript origins** with `https://app.livqeno.com`, and the
OAuth consent screen's app name / homepage / privacy URLs to the Livqeno
domain.

Only then, on the API's Container App (an env-var update — not a new
revision spec, not a rename):

```
APP_URL=https://app.livqeno.com
```

Every verification and password-reset link is built from `APP_URL`, so
links already sitting in inboxes keep pointing at `app.ravenstack.online`.
That is the reason §8 waits.

### Session cookies

The dashboard's cookies (`raven_session`, `raven_onboarding`,
`raven_oauth_state`) are host-scoped, so moving the dashboard to
`app.livqeno.com` **signs everybody out once**. That is expected and
harmless; they sign back in. Do not try to fix it by widening the cookie
domain — the names are deliberately unchanged so that no session logic
moves during a branding migration.

## 5. CORS

`CORS_ORIGIN` on the API is a comma-separated allowlist. During the
migration it must contain both dashboard origins:

```
CORS_ORIGIN=https://app.ravenstack.online,https://app.livqeno.com
```

This does not affect the SDK browser surfaces (`/v1/telemetry`, `/v1/chat`)
— those reflect the caller's origin by design and are gated by a
short-lived token, not by origin. Nothing about per-project allowed origins
changes either; those are values developers set for their own apps.

## 6. Email sending domain

Emails already *say* Livqeno (`RESEND_FROM_NAME`, and every template). Only
the envelope domain is still `mail.ravenstack.online`, because that is the
domain verified in Resend.

To move it, verify `mail.livqeno.com` in Resend and add the records it
issues. Same four-record shape as `docs/deployment/dns-email.md`, new zone:

| Name | Type | Value |
|---|---|---|
| `resend._domainkey.mail` | `TXT` | the DKIM key from the Resend dashboard |
| `rsend.mail` | `CNAME` | `rsend-apne1.forge.rmta.net` |
| `send.mail` | `CNAME` | `send.forge.rmta.net` |
| `_dmarc` | `TXT` | `v=DMARC1; p=none;` |

The two CNAME targets are region-specific (`apne1` — Tokyo). Read them off
the Resend dashboard rather than copying them if the region differs.

```bash
dig @1.1.1.1 +short TXT   resend._domainkey.mail.livqeno.com
dig @1.1.1.1 +short CNAME rsend.mail.livqeno.com
dig @1.1.1.1 +short CNAME send.mail.livqeno.com
dig @1.1.1.1 +short TXT   _dmarc.livqeno.com
```

All four must resolve before pressing **Verify**. Then, on the API:

```
RESEND_FROM_EMAIL=hello@mail.livqeno.com
EMAIL_SUPPORT_EMAIL=support@mail.livqeno.com
```

`EMAIL_SUPPORT_EMAIL` has to be a mailbox somebody reads — it is printed in
every email footer. `_dmarc` governs every sender for the domain, so do not
add a stricter policy than `p=none` until the DKIM record is verified and
sending is confirmed.

## 7. Optional: `api.livqeno.com`

Deliberately **not** part of this rebrand. `api.ravenstack.online` is a
custom domain on the existing Container App and it is what every published
SDK example, every `RAVEN_API_URL` default and every developer's deployed
backend points at. Renaming it is an API-breaking change for people
outside this repository, not a branding change.

If a Livqeno-branded API host is wanted later, it is additive: bind
`api.livqeno.com` as a *second* custom hostname on the same Container App,
serve both indefinitely, and treat the old one as a permanent alias. That
is its own task, with its own deprecation window. Do not fold it into the
rebrand.

`turn.ravenstack.online` is in the same position and is worse to move:
TURN credentials are realm-scoped (`TURN_REALM`), and the realm is
embedded in credentials the SFU and clients already hold. Leave it.

## 8. Retiring the old hostnames

Only after §1–§6 are done and verified, and after enough time has passed
for emailed links to expire (password-reset links are short-lived;
verification links last a day — `EMAIL_VERIFICATION_TTL_MINUTES=1440`):

1. Make `livqeno.com` the primary domain on `raven-landing`, and set
   `ravenstack.online` to redirect to it. Same for `app` and `docs`.
2. Drop `https://app.ravenstack.online` from `CORS_ORIGIN`.
3. Leave `api.ravenstack.online` and `turn.ravenstack.online` alone — §7.
4. Leave the `ravenstack.online` DNS zone in place. It still serves the API
   and TURN hostnames, and the redirects above depend on it resolving.

## What stays `raven` forever

Not oversights — renaming any of these breaks something that is already
deployed, or something outside this repository:

| Identifier | Why |
|---|---|
| `@ravenkash/*` npm scope, `raven-sdk` (PyPI), `raven_rtc` / `raven_chat` / `raven_live` (pub.dev) | Published packages. A rename orphans every existing install. |
| `Raven` (the client class), `RavenRoom`, `RavenError`, `RavenHttpClient`, … | Public SDK API surface, in developers' compiled code. |
| `raven` CLI binary, `~/.raven/config.json` | Renaming orphans every developer's existing CLI config. |
| `iss: 'raven'`, `aud: 'raven-rtc'`, `aud: 'raven-chat'` | Signed JWT claims the API *and* the SFU validate. Changing one invalidates every live token. |
| `Raven-Signature`, `Raven-Event-Id`, `Raven-Event-Type` | Webhook headers customers' receivers read today. |
| `Raven-Server-SDK/…`, `Raven-Webhooks/1.0` | User-Agent strings; may be matched on by customer infrastructure. |
| `raven_session`, `raven_onboarding`, `raven_oauth_state` | Cookie names — see §4. |
| `raven-api`, `raven-sfu`, `raven-production`, `ravenacr`, `raven-kv-ea1`, `raven-coturn`, `raven-network` | Azure resource names. Out of scope by construction. |
| `raven-landing`, `raven-dashboard`, `raven-docs` | Vercel project names, referenced by deploy scripts. |
| `RAVEN_API_URL`, `RAVEN_API_KEY`, `RAVEN_SFU_URL` | Documented env-var names in developers' own deployments. |
| `github.com/atulsinghhhh/Raven`, `module …/Raven/services/sfu` | Repository name and Go module path. |
| `TURN_REALM=raven.local` | TURN credentials are realm-scoped. |
| `--font-raven-*`, `raven-theme` | Internal CSS/localStorage keys; invisible, and renaming resets saved themes. |
