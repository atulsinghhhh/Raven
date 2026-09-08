# 03 — bcrypt blocks the event loop; authenticated REST tops out at ~13 req/s

**Severity:** Medium · **Area:** API / performance

## What is wrong

`ApiKeyAuthGuard` verifies an API key with `bcryptjs`, whose pure-JS
implementation runs **synchronously on the Node event loop**. Every
authenticated request therefore stalls the process for the duration of a
bcrypt comparison, and concurrency collapses.

Measured at **~13 req/s per process** for authenticated REST, versus
**3,770–4,040 req/s** unauthenticated on the same machine — a ~300×
gap attributable to one synchronous call. Full methodology and raw
artifacts in `docs/production/capacity-report.md` §1.

This is the first ceiling the deployment will hit: the Container App runs
0.5 vCPU with `maxReplicas: 2`, so roughly 26 req/s of authenticated
traffic in total.

## Why it matters more than the number suggests

The block is on the **event loop**, not a worker. While bcrypt runs, the
process serves nothing else — including chat and signaling WebSocket
frames on the same instance, and the `/health/live` probe. Under
authenticated load the liveness probe can time out and get the replica
restarted, which looks like an unrelated stability problem.

## Fix

Replace `bcryptjs` with the native `bcrypt` binding, whose comparisons run
on the libuv threadpool and do not block. It is a drop-in API change but
adds a native build step to the image.

Alternatives if a native dependency is unwanted:

- Move verification into a `worker_threads` pool.
- Cache verified key → project for a short TTL in Redis, so the bcrypt cost
  is paid once per key per window rather than per request. Note this
  weakens immediate revocation, so keep the TTL small.

Do not lower the bcrypt cost factor — that trades a real security property
for throughput, and the pepper design in `docs/control-plane.md` assumes a
meaningful factor.

## Verify the fix

`scripts/k6/api-load-test.js` reproduces the ceiling. Re-run it before and
after; the report's §1.2 isolation runs show how to attribute the change.

## Files

- `apps/api/src/modules/api-keys/**` (guard + service)
- `apps/api/src/shared/utils/crypto.util.ts`
- `docs/production/capacity-report.md` §1
