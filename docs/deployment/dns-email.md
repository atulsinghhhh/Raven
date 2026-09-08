# DNS setup for `mail.ravenstack.online`

A manual checklist. **Raven never changes DNS from code**, and the record
values below are deliberately left blank: SPF and DKIM values are
generated per-domain by Resend, and anything written here from memory
would be wrong in a way that fails silently — mail that sends, and lands
in spam.

Get the real values from the Resend dashboard after step 2.

---

## Checklist

1. **Sign in to Resend** → <https://resend.com>.
2. **Domains → Add Domain** → enter `mail.ravenstack.online`.
   - The subdomain, not the apex. See
     [email.md](../email.md#three-domains-three-jobs) for why.
   - Pick the region closest to where the API runs.
3. **Resend displays the DNS records to add.** Copy them exactly — do not
   retype the DKIM value; it is long and a single wrong character fails
   verification with no useful error.
4. **Add each record at your DNS provider** (whoever hosts
   `ravenstack.online`). Expect three kinds:

   | Purpose | Type | Name (as Resend shows it) | Value |
   |---|---|---|---|
   | DKIM — signs each message so a receiver can prove it came from you | `TXT` (or `CNAME`) | `resend._domainkey.mail` *(Resend gives the exact host)* | **From Resend** |
   | SPF — authorises Resend's servers to send as this domain | `TXT` | `send.mail` *(Resend gives the exact host)* | **From Resend** |
   | MX — return path for bounces | `MX` | `send.mail` *(Resend gives the exact host)* | **From Resend**, with the priority it shows |

   Two things that catch people:
   - Some providers append the zone automatically. If yours does, enter
     `resend._domainkey.mail`, **not**
     `resend._domainkey.mail.ravenstack.online` — otherwise you get
     `…mail.ravenstack.online.ravenstack.online`.
   - If an SPF `TXT` record already exists on that exact host, merge the
     two into one record. A host with two SPF records fails SPF outright.

5. **Add DMARC** — Resend does not generate this one; it is your policy
   choice, not a per-domain secret. Start in monitor mode:

   | Type | Name | Value |
   |---|---|---|
   | `TXT` | `_dmarc.mail` | `v=DMARC1; p=none; rua=mailto:dmarc@ravenstack.online` |

   `p=none` reports without rejecting. Once the reports show only Resend
   sending as this domain, tighten to `p=quarantine`, then `p=reject`.
   Going straight to `p=reject` before that is how legitimate mail
   disappears.

6. **Wait for propagation.** Usually minutes; up to 48 hours. Check with:

   ```bash
   dig +short TXT resend._domainkey.mail.ravenstack.online
   dig +short TXT send.mail.ravenstack.online
   dig +short MX  send.mail.ravenstack.online
   dig +short TXT _dmarc.mail.ravenstack.online
   ```

7. **Verify in Resend** → Domains → the domain → **Verify**. All records
   must read verified. A partially-verified domain sends, and lands in
   spam.

8. **Create an API key** → Resend → API Keys → *Sending access* only,
   scoped to this domain. The value is shown once. Put it straight into
   your secret store — never into `.env.example`, a commit, a CI log, or
   a Docker image.

9. **Set the API's configuration** (backend deployment only):

   ```env
   EMAIL_ENABLED=true
   RESEND_API_KEY=<the key>
   RESEND_FROM_EMAIL=hello@mail.ravenstack.online
   APP_URL=https://app.ravenstack.online
   ```

10. **Send a real test.** Register a throwaway account against the
    deployed API and confirm the verification email arrives. Then check:
    - it landed in the inbox, not spam;
    - the message's `Authentication-Results` header shows `dkim=pass` and
      `spf=pass` (Gmail: ⋮ → Show original);
    - the link opens `https://app.ravenstack.online/verify-email?token=…`
      and confirms the address.

    Until step 10 passes, the domain is not verified in any sense that
    matters — a green tick in the dashboard is a claim about DNS, not
    about delivery.

---

## Free-tier limits

3,000 emails/month, 100/day, 3 verified domains. Raven enforces its own
copy of the first two before calling Resend
([email.md](../email.md#free-tier-protection)) so a bug cannot spend the
month's allowance in an afternoon.

Three domains is enough for `mail.ravenstack.online` plus a staging
sender, with one spare.
