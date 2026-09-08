---
title: Production checklist
description: Everything to verify before real users. Items that cannot be satisfied yet are marked.
---

Work top to bottom. Anything marked **Not available** is a Raven gap, not
something you have missed — it is here so you can plan around it.

## Credentials and secrets

- [ ] A **production** API key, created separately from your development key.
- [ ] `RAVEN_API_KEY` in secret storage, not in the repository, not in a `.env` you commit.
- [ ] No API key reachable from any client bundle. Grep your built output for `rvk_`.
- [ ] Webhook signing secret stored separately from the API key.
- [ ] If self-hosting: `JWT_SECRET`, `RTC_TOKEN_SECRET`, `CHAT_TOKEN_SECRET`, `API_KEY_HASH_SECRET`, `SFU_REGISTRATION_SECRET`, `TURN_SECRET` each generated independently. Production validation refuses the `JWT_SECRET` fallback, so a boot failure here is the check working.
- [ ] A key rotation runbook: create → deploy → verify → revoke.

## Tokens

- [ ] RTC token TTL set deliberately — 600s is a good default, not 21600 because it is allowed.
- [ ] Tokens minted per participant per join, never reused across users.
- [ ] Identity taken from **your** authenticated session, never from the request body.
- [ ] Permissions minimal: viewers get `{ join, subscribe }` and nothing more.
- [ ] Chat clients wire `onTokenExpiring`. Without it a chat panel dies at the hour mark.
- [ ] The whole mint response forwarded to the client — `endpoint`, `iceServers`, `telemetryUrl` included, untouched.

## Transport

- [ ] `https://` for the API, `wss://` for both WebSockets.
- [ ] `CORS_ORIGIN` set to your actual origins. Not `*`.
- [ ] A valid certificate on the API and, if you use `turns:`, on coturn.

## TURN and connectivity

- [ ] `TURN_HOST` is the **host-facing** address, not a container name.
- [ ] `TURN_INTERNAL_HOST` is the container name the API's health probe uses.
- [ ] UDP 3478 and the relay port range open at the firewall.
- [ ] Relay path actually exercised — `scripts/turn-relay-test.sh`, not an assumption.
- [ ] coturn config parse errors treated as a **hard** failure in your tooling. It can otherwise fail open. ⚠️
- [ ] Tested on a restrictive network, not just your office.

## Environments

- [ ] Production and development use different API keys.
- [ ] **Separate databases per environment.** A shared database puts every media server in one global fleet, so a laptop can be allocated a production room. ⚠️ [Details](/reference/known-limitations)
- [ ] Webhook endpoints registered against the right environment.

## Webhooks

- [ ] Signature verified: raw body, timestamp window, constant-time compare.
- [ ] Deduplicated on `Raven-Event-Id`.
- [ ] Ordered by `createdAt`, not arrival.
- [ ] Responds 2xx within 5 seconds; real work happens after.
- [ ] Delivery failures monitored — an endpoint auto-disables after 50 consecutive failures, which is silent data loss otherwise.
- [ ] Delivery worker egress-filtered at the network level. Raven's SSRF check does not resolve DNS. ⚠️

## Monitoring

- [ ] Readiness (`/health/ready`) wired to the load balancer — **not** liveness.
- [ ] Liveness (`/health/live`) wired to the orchestrator's restart policy.
- [ ] `/metrics` scraped, and kept off the public ingress.
- [ ] Alerts on the **rate** of failed connections and on any negotiation failures.
- [ ] `LOG_LEVEL` set, logs shipped, `requestId` searchable.
- [ ] Someone knows to run `raven diagnostics` and `raven errors list` during an incident.

## Limits

- [ ] Message length validated in your composer, before the user presses send.
- [ ] Attachment size checked client-side against your storage limit.
- [ ] Token-mint rate (60/window) comfortable for your join pattern.
- [ ] `429` handled by honouring `retryAfterSeconds`, not a fixed backoff.
- [ ] Participants-per-room ceiling matches what your UI can actually render.

## Reliability

- [ ] Reconnection UI: a status banner, and the participant grid stays mounted.
- [ ] `failed` handled by minting a **fresh** token and rejoining.
- [ ] Graceful shutdown: `enableShutdownHooks` plus a preStop delay, so a deploy drains rather than cuts.
- [ ] Database connection pool sized against Postgres `max_connections` × pod count.

## Scaling — plan, do not assume

- [ ] You have measured your own capacity. Raven's 100-participant figure is loopback with synthetic media and is not a capacity number. ⚠️
- [ ] Media server fleet sized with headroom, and draining understood (`raven rtc servers drain`).
- [ ] PgBouncer in front of Postgres once pod count × pool size approaches the ceiling.

## Accept these gaps or change plan

Not oversights — Raven does not have them:

- [ ] **No recording.** Not available.
- [ ] **No usage metering or billing.** Not available.
- [ ] **No congestion-driven layer selection.** TWCC is collected, nothing consumes it. A degrading subscriber sees loss, not a downgrade. ⚠️
- [ ] **No web-side layer control.** Flutter only. ⚠️
- [ ] **No active-speaker event.** Approximate from per-track stats.
- [ ] **Chromium is the only browser exercised with real media.** ⚠️
- [ ] **Simulcast needs VP8, VP9 or H.264.** AV1 and H.265 cannot complete a layer switch.

## Before you announce a date

Read [Known limitations](/reference/known-limitations) end to end. It is
short, and it is the difference between a launch and a postmortem.

## Next steps

- [Build for production](/guides/build-for-production) — the same ground with the reasoning.
- [Security](/authentication/security) · [Health & metrics](/self-hosting/health-and-metrics)
