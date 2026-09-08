# 08 — SSH access is pinned to a single IP and breaks when it changes

**Severity:** Low · **Area:** Ops

## What is wrong

Both NSGs allow SSH from exactly one `/32`, set to whatever the operator's
public IP was when `02-network.sh` last ran:

```
raven-sfu-nsg     AllowSshFromAdmin  Tcp  <one-ip>/32  22
raven-coturn-nsg  AllowSshFromAdmin  Tcp  <one-ip>/32  22
```

On a residential or mobile connection that address changes, and every SSH
attempt then hangs until it times out — including the deploy and cert
scripts, which fail mid-run with no obvious cause. This happened twice
during deployment; the second time it interrupted the TURN certificate
issuance.

The restriction itself is correct and should stay. The problem is that it
is invisible when it breaks: a stale rule looks exactly like a dead host.

## Workaround today

```bash
RAVEN_ADMIN_CIDR="$(curl -fsS https://api.ipify.org)/32" ./02-network.sh
```

Idempotent, and updates both NSGs.

## Better fixes

1. **Have the deploy scripts self-heal.** Before the first SSH, compare the
   current public IP against the NSG rule and update it if it differs. Turns
   a confusing hang into a one-line log message. Cheapest real improvement.
2. **Fail fast with a useful message.** Even without auto-updating, a
   pre-flight check that says "your IP is X, the NSG allows Y" beats a
   `Connection timed out` after 20s.
3. **Azure Bastion** removes public SSH entirely — but it is ~$140/month,
   which is impossible on this budget (issue 02). Not an option here.
4. **`az vm run-command invoke`** works without SSH or an NSG rule and is
   free. Useful as a break-glass path when locked out.

## Files

- `infrastructure/azure/02-network.sh`
- `infrastructure/azure/06-deploy-sfu.sh`
- `infrastructure/azure/07-deploy-coturn.sh`
- `infrastructure/azure/11-turn-tls.sh`
- `infrastructure/azure/14-custom-domains.sh`
