---
---

Project origin changes now take effect across the whole API fleet, not just
the instance that served the edit.

`ProjectOriginService` caches each project's browser-origin policy because
the check runs on every telemetry event, chat REST call and WebSocket
upgrade. That cache was per-process with a 30-second TTL and a local-only
`invalidate()`, while Raven runs several API instances (`infrastructure/k8s`
deploys three; Azure Container Apps scales to two). So an edit cleared one
instance's map and left the others answering from a stale copy. For an
*added* origin that reads as the setting not working; for a *removed* one it
means an origin the developer just revoked keeps being accepted — a security
decision made on stale data.

Saving now publishes the project id on `raven:origins:invalidate` and every
instance drops its entry. The TTL stays as the backstop, deliberately not
raised: pub/sub is fire-and-forget, so an instance that was starting up or
briefly partitioned misses the message with no redelivery, and the TTL caps
how long it can stay wrong without Redis having been reliable.

The subscriber re-subscribes on every ioredis `ready`, so a first attempt
that fails does not downgrade that instance to TTL-only for its whole
lifetime — which is what happened under a parallel e2e run, silently, while
every test still passed. Its `commandTimeout` is raised to 15s for the same
reason, and kept finite: `0` in ioredis means "time out immediately", not
"never".

No release: server-side only.
