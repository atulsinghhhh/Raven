# OAuth sign-in (GitHub & Google)

Livqeno supports "Continue with GitHub" and "Continue with Google" alongside
email/password. Both are optional per deployment: a provider is enabled by
setting its client credentials, and the dashboard only renders buttons for
providers the Control API reports as configured (`GET
/v1/auth/oauth/providers`).

## How the flow works

The dashboard (`apps/dashboard`) is the browser-facing half; the Control API
(`apps/api`) holds every secret and does the actual exchange.

```
Browser                Dashboard (BFF)                Control API              Provider
  │  click "Continue     │                              │                        │
  │  with GitHub"        │                              │                        │
  │─────────────────────▶│ GET /api/auth/oauth/         │                        │
  │                      │     github/start             │                        │
  │                      │─────────────────────────────▶│ POST /v1/auth/oauth/   │
  │                      │                              │      github/start      │
  │                      │   { authorizeUrl, state }    │  state → Redis (10min) │
  │                      │◀─────────────────────────────│                        │
  │   redirect + state   │  state pinned in httpOnly    │                        │
  │◀─────────────────────│  cookie                      │                        │
  │──────────────────────────────────────────────────────────────────────────────▶│ authorize
  │◀─────────────────────────────────────────────────────────────────────────────│ redirect w/ code+state
  │─────────────────────▶│ GET /api/auth/oauth/         │                        │
  │                      │     github/callback          │                        │
  │                      │  cookie state == returned    │                        │
  │                      │  state? (CSRF)               │                        │
  │                      │─────────────────────────────▶│ POST /v1/auth/oauth/   │
  │                      │                              │      github/exchange   │
  │                      │                              │  state single-use      │
  │                      │                              │  (Redis GETDEL)        │
  │                      │                              │───────────────────────▶│ code → token
  │                      │                              │◀───────────────────────│ profile
  │                      │        AuthResult            │  find-or-create user   │
  │                      │◀─────────────────────────────│  issue session JWT     │
  │  session cookie +    │                              │                        │
  │  redirect            │                              │                        │
  │◀─────────────────────│  /onboarding or /dashboard   │                        │
```

Key properties:

- **Secrets stay server-side.** `GITHUB_CLIENT_SECRET` / `GOOGLE_CLIENT_SECRET`
  are read only by the Control API. The dashboard has no OAuth configuration
  at all; the browser only ever sees redirects.
- **State is validated twice.** The httpOnly cookie proves the callback
  arrived in the browser that started the flow (CSRF); the Redis `GETDEL`
  makes each state single-use (replay). TTL is `OAUTH_STATE_TTL_SECONDS`
  (default 600).
- **Provider tokens are never stored.** The access token proves identity
  during the exchange and is discarded; `auth_accounts` rows carry only the
  provider's stable account id and a display email.
- **No duplicate accounts.** A returning provider account resolves through
  the unique `(provider, providerAccountId)` link. A first-time provider
  login whose (provider-verified) email matches an existing Livqeno account
  links to it; an unverified provider email is refused
  (`RAVEN_OAUTH_EMAIL_UNVERIFIED`) so it can't take over the account.
- **Same session either way.** OAuth logins go through the same
  `issueSessionForUser()` as passwords: same JWT claims, same `jti`
  revocation, same logout.
- **OAuth-only accounts have no password.** `users.passwordHash` is null for
  them; email/password login answers with the usual "invalid email or
  password", and account settings offers "set a password" via the standard
  reset-email flow.

## Configuration

All variables live in the root `.env` (see `.env.example`) and are validated
at boot — a provider with an id but no secret refuses to start.

| Variable | Meaning |
| --- | --- |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | From your GitHub OAuth App (Settings → Developer settings → OAuth Apps). |
| `GITHUB_CALLBACK_URL` | Optional. Defaults to `<APP_URL>/api/auth/oauth/github/callback`. Must match the OAuth app's registered callback exactly. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google Cloud Console → APIs & Services → Credentials (OAuth client, type "Web application"). |
| `GOOGLE_CALLBACK_URL` | Optional. Defaults to `<APP_URL>/api/auth/oauth/google/callback`. |
| `OAUTH_STATE_TTL_SECONDS` | How long a started sign-in stays completable. Default 600. |

Register these callback URLs with the providers (replace `APP_URL` with the
dashboard origin, e.g. `https://app.ravenstack.online`):

- GitHub → `<APP_URL>/api/auth/oauth/github/callback`
- Google → `<APP_URL>/api/auth/oauth/google/callback`

In production the callback URLs must be `https://` — boot validation
enforces it.

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /v1/auth/oauth/providers` | none | Which providers are configured (drives the login buttons). |
| `POST /v1/auth/oauth/:provider/start` | rate-limited | Mints a state, returns the provider authorize URL. Called by the dashboard BFF only. |
| `POST /v1/auth/oauth/:provider/exchange` | rate-limited | Burns the state, exchanges the code, finds/creates the user, returns the session. |

Error codes: `RAVEN_OAUTH_ERROR` (bad/expired state, rejected code),
`RAVEN_OAUTH_EMAIL_UNAVAILABLE` (provider shared no usable email),
`RAVEN_OAUTH_EMAIL_UNVERIFIED` (linking refused), `RAVEN_NOT_CONFIGURED`
(provider off). The dashboard maps each to a human sentence on `/login`.

## Onboarding interaction

Login, register, and OAuth exchange responses all carry
`onboarding: { completed, step }`. The dashboard stores a routing hint in
the `raven_onboarding` cookie: incomplete accounts are sent to
`/onboarding`, complete ones to `/dashboard`. The hint is not an
authorization boundary — both pages re-verify against `GET /v1/onboarding`.
