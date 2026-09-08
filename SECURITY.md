# Security Policy

Raven is real-time communication infrastructure. A vulnerability here can
mean someone joining a call they were never granted, minting a token for
another project, or relaying traffic through your TURN server on your bill.
We take reports seriously and would rather hear about a problem early and
imperfectly than late and precisely.

---

## Reporting a vulnerability

**Do not open a public issue.** A public issue discloses the problem to
everyone at once, including people who will use it before anyone can
deploy a fix.

Use **[GitHub private vulnerability reporting](https://github.com/atulsinghhhh/Raven/security/advisories/new)**
— it is private between you and the maintainers, it lets us collaborate on
a fix in a private fork, and it issues the CVE and advisory when we
publish.

> If that link 404s, private reporting has not been enabled yet on this
> repository. In that case open a public issue titled **"Security contact
> request"** with **no technical detail at all** — just ask us to get in
> touch — and we will reply with a private channel.

### What to include

As much of this as you have. A partial report is still worth sending.

- What the issue is, and which component (control plane, signaling, SFU,
  TURN, chat, a specific SDK)
- How to reproduce it — the smallest sequence you can manage
- What an attacker gets out of it, and what they need to start with
  (nothing? a valid token for another room? a project API key?)
- Affected version, commit SHA, or deployment
- Anything you already know about a fix

### What to expect

This is a small project, currently maintained by one person, so these are
honest targets rather than a corporate SLA:

| | Target |
|---|---|
| We acknowledge your report | within **3 business days** |
| We confirm or dispute it | within **10 business days** |
| Fix for a critical issue | as fast as we can, and we will keep you posted |
| Public advisory | after a fix ships, or 90 days, whichever is first |

We will tell you what we found, credit you in the advisory unless you would
rather we did not, and let you know before we publish.

### Safe harbour

If you are acting in good faith to find and report a vulnerability, we will
not pursue or support legal action against you. Please:

- Test only against your **own** deployment or a local stack
  ([docs/local-development.md](./docs/local-development.md) gets you one)
- Do not access, modify or retain data belonging to anyone else
- Do not run denial-of-service, spam or load tests against a shared
  deployment
- Give us a reasonable window to fix before disclosing publicly

There is no bug bounty. We can offer credit and genuine thanks.

---

## Supported versions

Raven is **pre-1.0 and has not had its first release**. Nothing on npm,
PyPI or pub.dev is published from this repository yet, and no version is
under long-term support.

| Version | Supported |
|---|---|
| `main` | ✅ Fixes land here |
| Anything else | ❌ |

Once packages are released this table will list the supported minors. Until
then, "supported" means `main`.

---

## Scope

**In scope** — anything in this repository:

- Control plane and signaling gateway (`apps/api`)
- The SFU (`services/sfu`)
- Client and server SDKs (`packages/*`, `sdks/*`)
- Dashboard (`apps/dashboard`), CLI (`packages/cli`)
- Deployment configuration under `infrastructure/`, and the Docker/Compose
  setup
- The token, API-key and TURN-credential model described below

**Out of scope:**

- Vulnerabilities in third-party dependencies with no Raven-specific
  exploit path — report those upstream. If Raven's use of a dependency is
  what makes it exploitable, that *is* in scope.
- Anything requiring an attacker to already hold a project API key. That
  key is a permanent full-project credential by design; protecting it is
  the operator's job.
- Missing hardening headers or best-practice warnings with no demonstrated
  impact.
- Denial of service by sheer volume against a public demo.
- Social engineering, physical access, or a compromised end-user device.
- The known, already-documented issues below.

---

## Already known

These are public, documented, and do **not** need a private report. Ranked
by what will hurt first.

- **[coturn fails open](./docs/issues/05-coturn-fails-open.md)** — an
  unreadable config turns the TURN server into an open relay. This is a
  real security issue in the deployed configuration.
- **[Every environment shares one database](./docs/issues/01-shared-database-sfu-registry.md)**
  — development SFUs can register into the production fleet.
- **[bcrypt blocks the event loop](./docs/issues/03-bcrypt-blocks-event-loop.md)**
  — authenticated REST tops out around 13 req/s, which is a cheap
  denial-of-service.
- **[Browser RTC is unverified end to end](./docs/issues/09-browser-rtc-unverified.md)**
  and relay-only NAT traversal has never been forced in a test — see
  [the test matrix](./docs/rtc/test-matrix.md) for exactly what is and is
  not exercised.

Full list: [`docs/issues/`](./docs/issues/).

A finding that is *worse than documented* — for example, an actual exploit
path for the coturn issue — is worth a private report even though the issue
itself is public.

---

## Security model

Worth reading before reporting, because several designs that look wrong are
deliberate:

- **[RTC security](./docs/rtc/security.md)** — token scoping, permissions,
  what a client is and is not told
- **[Server SDK security](./docs/security/server-sdk.md)** — why the API key
  never reaches a browser
- **[Chat security](./docs/security/chat.md)**
- **[Networking and TURN](./docs/rtc/networking.md)**

The load-bearing invariants:

- **Two planes fail independently.** The control plane decides *whether* you
  may publish or subscribe and signs a short-lived token that says so. It
  never carries media.
- **Clients are never told an SFU's address.** A join learns the node's
  *name*, for support.
- **Identity comes from your backend session**, never from a request body.
  A browser must never mint its own token.
- **Three secrets must be distinct** — `JWT_SECRET`, `RTC_TOKEN_SECRET` and
  `SFU_REGISTRATION_SECRET`. Production **refuses to start** otherwise: a
  deployment where one leaked credential mints all of them is worse than one
  that will not boot.
- **API keys are stored only as a bcrypt hash.** The full key is returned
  exactly once, at creation.
- **TURN credentials are ephemeral and per-token.**

---

## For operators

If you run Raven yourself, most of your real risk is configuration:

- Generate `JWT_SECRET`, `RTC_TOKEN_SECRET`, `API_KEY_HASH_SECRET`,
  `CHAT_TOKEN_SECRET` and `SFU_REGISTRATION_SECRET` independently
  (`openssl rand -hex 32` each). Never reuse one across roles.
- Never commit a real `.env`. The repo scans its full history with
  [gitleaks](./docs/security.md) on every push, and `.env` is gitignored.
- `infrastructure/k8s/base/api-secret.yaml` is a **placeholder manifest**
  documenting the shape of what the API needs. Replace it with an
  ExternalSecret or SealedSecret. Do not deploy it as-is.
- Set `SFU_PUBLIC_IP` in production, and publish the UDP range. See
  [networking](./docs/rtc/networking.md).
- Pin an image version tag rather than `latest`
  ([SFU image](./docs/rtc/sfu.md#official-container-image)).
- Rotate the TURN secret periodically —
  `infrastructure/azure/rotate-turn-secret.sh`.

---

## How this repository is scanned

Secret scanning (gitleaks, full history), dependency scanning (pnpm audit,
pip-audit, govulncheck), container scanning (Trivy, blocking on CRITICAL)
and CodeQL all run in CI. What runs where, and what to do when one goes
red, is documented in **[docs/security.md](./docs/security.md)**.
