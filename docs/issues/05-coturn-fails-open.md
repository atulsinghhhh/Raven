# 05 — coturn fails open: an unreadable config becomes an open relay

**Severity:** Medium · **Area:** Security

## What is wrong

coturn does **not exit** when it cannot read the config file passed with
`-c`. It logs a warning and continues **with defaults** — no realm and
**no authentication** — which is an open TURN relay that anyone on the
internet can allocate through. The container stays "up" and passes every
liveness check while doing it.

## This already happened

During Phase 2 the config was written mode `600` owned by the SSH user,
while the `coturn/coturn` image runs as `nobody:nogroup` (uid 65534). coturn
could not read it, started with no auth, and was an open relay for roughly
five minutes on UDP/TCP 3478. It was caught only because the next test
asserted that an **unauthenticated** Allocate is refused — it returned
success instead of 401.

## Current mitigations

Both deploy scripts now chown the config to `65534:65534`, keep it `600`,
and assert the realm loaded — stopping the container if not:

```bash
docker logs raven-coturn 2>&1 | grep -q "Default realm: ${TURN_HOST}"
```

`infrastructure/azure/tests/verify-domains.sh` independently checks that a
forged credential gets a 401.

## Why it is still open

The mitigation is a **post-hoc assertion in two scripts**. Anyone who
restarts coturn by hand, edits the config in place, or renews a certificate
without re-running the script can reintroduce the state with nothing
watching. The failure is silent and the blast radius is an open relay
attributable to your IP.

## Fix options

1. **Monitor it continuously**, not just at deploy: a periodic check that
   an unauthenticated Allocate returns 401, alerting if not. This is the
   one that actually closes the gap.
2. **Make the container fail to start** instead of failing open — an
   entrypoint wrapper that verifies the config is readable and contains
   `static-auth-secret` before exec'ing `turnserver`.
3. Add the assertion to any future cert-renewal automation. The current
   Let's Encrypt deploy hook restarts coturn and does **not** re-assert
   the realm.

## Files

- `infrastructure/azure/07-deploy-coturn.sh`
- `infrastructure/azure/11-turn-tls.sh`
- `infrastructure/azure/14-custom-domains.sh`
- `infrastructure/azure/tests/turn_allocate.py`
