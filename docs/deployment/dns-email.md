# DNS for `mail.ravenstack.online`

The sending domain for Raven's transactional email. **Verified in Resend
on 2026-09-08**, region `ap-northeast-1` (Tokyo).

DNS for `ravenstack.online` is **not** served by the registrar. The domain
is registered at GoDaddy, but its nameservers delegate to **Azure DNS**:

```
ns1-04.azure-dns.com.   ns2-04.azure-dns.net.
ns3-04.azure-dns.org.   ns4-04.azure-dns.info.
```

Records live in the zone `ravenstack.online`, resource group
`raven-production`. Anything added in GoDaddy's DNS panel is ignored while
that delegation stands — a trap worth knowing before spending an afternoon
on records that were never authoritative.

**Raven never changes DNS from code.** This is a manual checklist.

---

## What is actually configured

Resend generates these per domain, and the two CNAME targets encode the
region — `apne1` is Tokyo. **Do not copy the values below into a new
domain**: a fresh domain gets a fresh DKIM keypair, and pointing DNS at
another domain's key fails verification.

| Purpose | Type | Name (relative to the zone) | Value |
|---|---|---|---|
| DKIM | `TXT` | `resend._domainkey.mail` | `p=…` — the public key from the dashboard, pasted verbatim |
| SPF (delegated) | `CNAME` | `rsend.mail` | `rsend-apne1.forge.rmta.net` |
| Return path | `CNAME` | `send.mail` | `send.forge.rmta.net` |
| DMARC | `TXT` | `_dmarc` | `v=DMARC1; p=none;` |

Four things about that table that cost time if you get them wrong:

- **`rsend` is not a typo for `send` or `resend`.** Resend's current MTA
  setup uses two distinct hosts. "Correcting" either breaks verification.
- **There is no SPF `TXT` record, and you must not add one.** SPF is
  delegated through the CNAMEs. A `v=spf1 include:…` at `mail` would be a
  second, competing authority. For the same reason, nothing else may share
  a name with a CNAME — a name holding a CNAME can hold no other record
  type (RFC 1034), and Azure rejects the attempt.
- **DMARC sits at the apex**, `_dmarc`, not `_dmarc.mail`. It therefore
  governs *every* sender for `ravenstack.online`, not just Resend. Adding
  another sender later (Google Workspace, say) means editing that one
  record, never creating a second — two DMARC records at one name is the
  same failure as two SPF records: the policy is discarded entirely.
- **`p=none` with no `rua=` reports to nobody.** It is a valid, inert
  starting policy, and it gives no visibility into who is sending as the
  domain. Adding `rua=mailto:dmarc@ravenstack.online;` is what makes
  tightening to `p=quarantine` later a measured decision rather than a
  guess — it needs that mailbox to exist first.

## Adding them (Azure DNS)

Names are relative to the zone; Azure appends `.ravenstack.online`
itself. Entering the fully-qualified name produces
`…ravenstack.online.ravenstack.online` and fails silently. Azure has no
"Auto" TTL — 3600 is fine, and Resend does not care.

Portal: **DNS zones → ravenstack.online → + Record set**. Or the CLI:

```bash
RG=raven-production; Z=ravenstack.online

az network dns record-set txt create -g $RG -z $Z -n resend._domainkey.mail --ttl 3600
az network dns record-set txt add-record -g $RG -z $Z -n resend._domainkey.mail -v 'p=<from the dashboard>'

az network dns record-set cname create -g $RG -z $Z -n rsend.mail --ttl 3600
az network dns record-set cname set-record -g $RG -z $Z -n rsend.mail -c rsend-apne1.forge.rmta.net

az network dns record-set cname create -g $RG -z $Z -n send.mail --ttl 3600
az network dns record-set cname set-record -g $RG -z $Z -n send.mail -c send.forge.rmta.net

az network dns record-set txt create -g $RG -z $Z -n _dmarc --ttl 3600
az network dns record-set txt add-record -g $RG -z $Z -n _dmarc -v 'v=DMARC1; p=none;'
```

Single-quote both TXT values: the DKIM key contains `/` and `+`, and the
DMARC value contains `;`.

## Verifying

```bash
dig @1.1.1.1 +short TXT   resend._domainkey.mail.ravenstack.online
dig @1.1.1.1 +short CNAME rsend.mail.ravenstack.online
dig @1.1.1.1 +short CNAME send.mail.ravenstack.online
dig @1.1.1.1 +short TXT   _dmarc.ravenstack.online
```

All four must return values before pressing **Verify** in Resend. A failed
first attempt is usually negative caching — a resolver that was asked
before the records existed and remembered the empty answer. Wait a minute
and press again rather than editing anything.

Checking against Azure's own nameserver (`dig @ns1-04.azure-dns.com …`)
separates "not published yet" from "published, not propagated".

## Then

1. Create an API key in Resend: **sending access only**, scoped to this
   domain. The value is shown once — put it straight into the secret
   store. Never into `.env.example`, a commit, a CI log, or an image.
2. Set the API's configuration (**backend deployment only** — see
   [email.md](../email.md#production-configuration)).
3. Send a real test: register a throwaway account against the deployed
   API, and confirm the verification email arrives, lands in the inbox
   rather than spam, and that its `Authentication-Results` header shows
   `dkim=pass` and `spf=pass` (Gmail: ⋮ → Show original).

A verified tick in the dashboard is a claim about DNS, not about delivery.
Step 3 is the one that settles it.

## Free-tier limits

3,000 emails/month, 100/day, 3 verified domains. Raven enforces its own
copy of the first two before calling Resend
([email.md](../email.md#free-tier-protection)) so a retry loop cannot
spend the month's allowance in an afternoon.

Until a domain is verified, the free plan only delivers to your own
account address — worth knowing when a test to a colleague silently goes
nowhere.
