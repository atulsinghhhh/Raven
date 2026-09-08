# Transactional email

Raven sends transactional email through [Resend](https://resend.com). One
service (`apps/api/src/modules/email/`) owns the integration; nothing else
in the repository constructs a Resend client, and nothing outside the API
process ever sees the key.

```text
Browser  ──signup / reset / member-add──▶  Raven API
                                              │
                                              ▼
                                         EmailService
                                              │
                                              ▼
                                           Resend
                                              │
                                              ▼
                                   mail.ravenstack.online
                                              │
                                              ▼
                                        user's inbox
```

There is no path from a browser, a mobile app or an SDK package to Resend.
`RESEND_API_KEY` is read by `apps/api` alone.

---

## Three domains, three jobs

| Domain | What it is | Where it is configured |
|---|---|---|
| `ravenstack.online` | The website | Vercel (`apps/www`) |
| `app.ravenstack.online` | The dashboard — where every emailed link goes | Vercel (`apps/dashboard`), and `APP_URL` on the API |
| `mail.ravenstack.online` | The sending domain — where email comes *from* | Verified in Resend; `RESEND_FROM_EMAIL` |

**Send from the subdomain, not the apex.** Transactional mail builds its
own sending reputation. Keeping it on `mail.` means a bad week for email
deliverability cannot spill onto the apex domain that serves the website,
and it leaves the apex free for a different provider later without a
migration.

Addresses on it: `hello@`, `notifications@`, `support@`.

---

## Environment variables

Server-side only. Every one of these belongs to the **API's** deployment —
none of them go into a Vercel project, a browser bundle, an SDK package,
or a mobile app, and none of them may ever carry a `NEXT_PUBLIC_` or
`VITE_` prefix.

| Variable | Default | What it does |
|---|---|---|
| `EMAIL_ENABLED` | `false` | Master switch. False logs instead of sending. |
| `RESEND_API_KEY` | — | The Resend key. Required when enabled; boot fails without it. |
| `RESEND_FROM_EMAIL` | `hello@mail.ravenstack.online` | Must be on a domain verified in Resend. The default applies only while email is **off** — with `EMAIL_ENABLED=true`, boot requires it to be set explicitly, because the sending identity is a deployment decision and not something to inherit silently. |
| `RESEND_FROM_NAME` | `Raven` | Display name on the From header. |
| `EMAIL_REPLY_TO` | unset | Where a human reply goes. Unset = replies land on the From address. |
| `EMAIL_SUPPORT_EMAIL` | `support@mail.ravenstack.online` | Printed in every footer. |
| `APP_URL` | `http://localhost:3000` | **The dashboard's origin.** Every emailed link is built from it. |
| `DOCS_URL` | `https://docs.ravenstack.online` | Linked from the welcome email. |
| `EMAIL_VERIFICATION_TTL_MINUTES` | `1440` | Verification link lifetime. |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | Reset link lifetime. |
| `EMAIL_COOLDOWN_SECONDS` | `60` | Per-recipient, per-type send cooldown. |
| `EMAIL_DAILY_LIMIT` | `100` | Raven's own daily cap (free tier). |
| `EMAIL_MONTHLY_LIMIT` | `3000` | Raven's own monthly cap (free tier). |
| `EMAIL_MAX_ATTEMPTS` | `3` | Attempts per message, transient failures only. |
| `EMAIL_RETRY_BASE_MS` | `500` | Backoff base: 500ms, 1s, 2s… |
| `EMAIL_DEV_PREVIEW` | `false` | Local only. Prints rendered emails, **including live links**. Refused in production. |

Validation runs at boot (`shared/config/env.validation.ts`):

- `EMAIL_ENABLED=true` with no `RESEND_API_KEY` → the process refuses to
  start, naming the variable. This is deliberate: an API that boots and
  then cannot send verification emails is a silent outage.
- The `.env.example` placeholder is rejected as if it were empty.
- In production, `APP_URL` must be set, `https://`, and not localhost.
- In production, `EMAIL_DEV_PREVIEW=true` is refused.

No validation message ever contains the key's value.

---

## Which emails Raven sends

Five, and no more. Product events belong in
[webhooks](./chat/webhooks.md), not in a developer's inbox.

| Email | Trigger | Notes |
|---|---|---|
| Email verification | `POST /v1/auth/register`, and `POST /v1/auth/verify-email/resend` | Single-use link, 24h |
| Welcome | after verification succeeds | Not sent at signup — see below |
| Password reset | `POST /v1/auth/password-reset` | Single-use link, 1h |
| Password changed | after a reset completes | Security notification; exempt from the cooldown |
| Added to a project | `POST /v1/projects/:id/members` | Notification, not an invitation — see below |

**Why welcome waits for verification.** Two emails per signup is two
messages against a 100/day free tier for every registration, and the
welcome has nothing to say that the verification email does not.
Verification also proves the address is deliverable, which is the first
moment a welcome is worth spending.

**Why the member email is not an invitation.**
`ProjectMembersService.add()` requires the person to already have a Raven
account — there is no invitation flow, and the email says so rather than
implying a pending state with no endpoint behind it.

---

## Flows

### Email verification

```text
register ─▶ create user ─▶ issue token ─▶ store SHA-256 + expiry ─▶ email link
                                                                       │
        mark verified ◀─ validate + consume ◀─ POST /v1/auth/verify-email
                │
                └─▶ welcome email
```

- The raw token exists in memory and in one email. Postgres holds only a
  SHA-256 of it (`user_tokens.tokenHash`).
- Single-use, enforced by a conditional `UPDATE`: two requests carrying
  the same token race for one row and exactly one wins.
- Issuing a new link invalidates the previous one.
- The URL carries the token and nothing else — no user id, no email
  address, no account data.
- Tokens are never logged, at any level, in any environment.
- Invalid, already-used and expired all return the same 400.
- An unverified account can still sign in. Blocking login would mean an
  undelivered email locks a developer out of a working account;
  `user.emailVerified` on the auth response is what lets the dashboard
  prompt instead.

### Password reset

```text
POST /v1/auth/password-reset  ─▶ (account exists?) ─▶ issue token ─▶ email link
                    │                                                     │
                    └──▶ 202, identical message either way                │
                                                                          ▼
POST /v1/auth/password-reset/confirm ─▶ validate + consume ─▶ new hash ─▶ revoke
                                                                 │        siblings
                                                                 └─▶ "password changed" email
```

- **No user enumeration.** The endpoint answers 202 with the same body for
  a registered and an unregistered address. The dashboard's form shows the
  same screen either way, and surfaces only a 429.
- Passwords are never emailed, and cannot be: Raven stores a bcrypt hash.
- Reset tokens are never logged.
- Completing a reset invalidates every other outstanding reset link.

**Known limitation.** Sessions issued *before* a reset keep working until
they expire (12h by default). Raven's JWTs are stateless and `logout`
blocklists one `jti` at a time, so there is no list of a user's live
tokens to revoke. The password-changed notification is what closes this
gap operationally — a victim finds out immediately. Fixing it properly
means a `passwordChangedAt` claim check in the JWT strategy; that is a
change to session handling, not to email, and is not in this work.

---

## Local development

Default state of a fresh clone: `EMAIL_ENABLED=false`. Nothing is sent,
nothing hits the network, and every flow still works. Each attempt logs:

```text
email skipped (EMAIL_ENABLED=false) type=email_verification recipientDomain=example.com subject="Confirm your Raven email address"
```

The result object says `skipped`, never `sent` — no code path claims a
delivery that did not happen.

**Completing verification or reset locally.** The token only exists as a
SHA-256 in Postgres, so there is nothing to look up. Two options:

1. `EMAIL_DEV_PREVIEW=true` — prints the rendered text part, links
   included, to your terminal. Off by default, refused in production, and
   the only place Raven ever writes a live token to a log.
2. Set `EMAIL_ENABLED=true` with a real key and send to an address you
   control. Resend allows sending to your own account address before a
   domain is verified.

**Tests** never touch Resend. `EmailService` takes its client through DI
(`RESEND_CLIENT`), so specs inject a four-line fake. CI needs no API key,
and there is no code path that would use one if it were present.

---

## Free-tier protection

Resend's free plan: **3,000 emails/month, 100/day, 3 domains**. Nothing in
this implementation assumes a paid plan.

Three guards run before the API call, in order:

1. **Enabled** — no client, no send.
2. **Cooldown** — one email of a given type per recipient per
   `EMAIL_COOLDOWN_SECONDS` (Redis `SET NX EX`). This is what stops a
   retry loop, a double-clicked button, or an impatient user turning one
   signup into fifty sends. The password-changed notification opts out:
   if an attacker changes a password twice, the victim must see both.
3. **Quota** — Raven's own daily and monthly counters, in UTC to match
   Resend's windows. Hitting our counter costs nothing; hitting theirs
   means the month is gone.

The counters *reserve* rather than settle: a message that then fails still
consumed a slot. That over-counts slightly, which is the right direction
to be wrong in.

On top of that, the HTTP endpoints carry the API's existing rate limiter
(`@RateLimit`): 5/window/IP for reset requests, 3/window for resending a
verification, 10/window for redeeming a link.

Never work around the plan limits by rotating keys or opening additional
Resend accounts. If the caps are genuinely too low, upgrade the plan and
raise `EMAIL_DAILY_LIMIT` / `EMAIL_MONTHLY_LIMIT` to match it.

---

## Retries

Errors are classified, not blindly retried
(`classifyResendError` in `email.service.ts`):

| Class | Resend codes | Behaviour |
|---|---|---|
| Transient | `rate_limit_exceeded`, `internal_server_error`, `application_error`, `concurrent_idempotent_requests`, plus any thrown network error | Retry with bounded exponential backoff, up to `EMAIL_MAX_ATTEMPTS` |
| Provider quota | `daily_quota_exceeded`, `monthly_quota_exceeded` | Fail immediately, logged at error — more attempts cannot help |
| Permanent | everything else, including unknown codes | Fail immediately, no retry |

An unknown code defaults to permanent: retrying something we do not
understand is how a bad address becomes a rate-limit ban.

**No queue.** Raven has no general job queue — the webhook worker polls
Postgres directly (`docs/deployment/production.md` §11.1) — and email did
not justify introducing one. The limitation, stated plainly: a message
that exhausts its attempts is lost, and the user must ask again. For
verification and reset that is a working recovery path (both endpoints can
be called again); for the member-added notification it means an occasional
missed notice. If email volume ever justifies durability, the fix is a
real queue, not a copy of the webhook poller.

---

## Logging

Logged: email type, recipient **domain**, Resend message id, attempt
number, outcome, error code.

```text
email sent type=password_reset recipientDomain=example.com messageId=8f2b… attempt=1
```

Never logged: the API key, verification tokens, reset tokens,
authorization headers, full recipient addresses, or message bodies. The
single exception is `EMAIL_DEV_PREVIEW`, which is off by default and
refused in production.

The Resend message id is worth keeping: it is the join key between a
Raven log line and the delivery record in Resend's own dashboard.

---

## Metrics

Four counters on the existing `/metrics` endpoint:

| Metric | Labels |
|---|---|
| `raven_emails_attempted_total` | `type` |
| `raven_emails_sent_total` | `type` |
| `raven_emails_failed_total` | `type`, `reason` |
| `raven_emails_skipped_total` | `type`, `reason` |

`sent` means **accepted by Resend**, not delivered — bounces, complaints
and opens live in Resend's dashboard, and Raven does not try to
reimplement them.

Worth alerting on: any `skipped{reason="daily_quota"}` or
`skipped{reason="monthly_quota"}` (the free tier has run out, and new
signups are getting no verification email), and a sustained ratio of
`failed` to `attempted`.

---

## Production configuration

On the **API's** deployment only (Azure Container Apps per
`docs/deployment/production.md`), with the key in Key Vault:

```env
EMAIL_ENABLED=true
RESEND_API_KEY=<from the Resend dashboard, via your secret store>
RESEND_FROM_EMAIL=hello@mail.ravenstack.online
RESEND_FROM_NAME=Raven
EMAIL_SUPPORT_EMAIL=support@mail.ravenstack.online
APP_URL=https://app.ravenstack.online
```

Not on Vercel. Not in the Docker image. Not in Git.

---

## DNS setup

See [dns-email.md](./deployment/dns-email.md) — the checklist for
verifying `mail.ravenstack.online` in Resend.

## Related

- [`docs/deployment/dns-email.md`](./deployment/dns-email.md) — DNS checklist
- [`docs/deployment/production.md`](./deployment/production.md) — where the API runs
- [`docs/control-plane.md`](./control-plane.md) — auth endpoints
- [`docs/security/`](./security/) — secret handling
