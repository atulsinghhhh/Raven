# Browser origin, CORS and RTC token revocation — verification record

What was actually executed, and what came out. Dated **2026-09-10**, against
the working tree on `fix/sfu-dtls-answering-role`.

The categories below are kept apart on purpose. "The tests pass" is four
different claims with four different strengths, and collapsing them into one
is how a green suite ends up standing in for a browser nobody opened.

---

## 1. Environments used

| | Control plane | Database | Redis | SFU |
| --- | --- | --- | --- | --- |
| **Local** | `http://localhost:4199`, this working tree | scratch Postgres `raven_validate` on `:55432` | scratch Redis on `:6399` | none registered |
| **Hosted** | `https://api.ravenstack.online` | production Supabase | production | production, registered and healthy |

The scratch Postgres and Redis exist because `.env`'s `DATABASE_URL` points
at the Supabase instance every environment shares. `test/guard-database-target.ts`
refuses to run the e2e suite against it, and the same reasoning applies to a
local API: **the production database was never migrated, seeded or written to
by this work.**

---

## 2. Unit — PASS

Run with `npx jest` in each package.

| Package | Suites | Tests |
| --- | --- | --- |
| `apps/api` | 58 | 844 |
| `apps/dashboard` | 13 | 159 |
| `packages/sdk` | 14 | 202 |
| `packages/chat-sdk` | 5 | 75 |
| `packages/cli` | 17 | 164 |
| `packages/react-native-sdk` | 7 | 76 |
| `packages/react-sdk` | 7 | 63 |
| `packages/effects` | 8 | 60 |
| `packages/server-sdk` | 6 | 53 |
| `packages/client` | 2 | 28 |

New in this pass:

- `rtc-token-revocation.service.spec.ts` — tombstone TTL bounded by the
  token's own expiry, only the `jti` stored, fail-open on an unreachable
  Redis, namespaced apart from chat.
- `rtc-token-verifier.service.spec.ts` — the revocation cases the brief
  asked for (valid / expired / revoked / unknown entry), plus two ordering
  properties: an expired token never costs a Redis lookup, and a token whose
  signature failed never reaches the revocation keyspace at all.
- `rtc-tokens.service.revoke.spec.ts` — revoke is scoped through the room, so
  project *and* environment isolation apply; another tenant's token id
  resolves to 404 rather than 403.
- `project-origin.invalidation.spec.ts` — two `ProjectOriginService`
  instances over one fake Redis bus, which is what makes the multi-instance
  claim testable rather than asserted.
- `signaling-error-codes.spec.ts` (`packages/sdk`) — `USAGE_LIMIT_EXCEEDED`
  and `TOKEN_REVOKED` arrive as their own typed codes rather than
  `SIGNALING_ERROR`.

## 3. Integration / e2e — PASS

`jest --config ./test/jest-e2e.json`, against the scratch Postgres and Redis:
**8 suites, 192 tests.**

Includes `signaling.e2e-spec.ts` and `chat.e2e-spec.ts`, which exercise both
gateways over real sockets.

## 4. Migration — applied to a scratch database, not to production

`20260910120000_add_project_allowed_origins`.

- `prisma validate` — schema valid.
- `prisma migrate deploy` against `raven_validate` — the full chain, 14
  migrations, applied cleanly with this one last.
- Columns verified in `information_schema`:

  | Column | Type | Nullable | Default |
  | --- | --- | --- | --- |
  | `allowedOrigins` | `text[]` | `NO` | `ARRAY[]::text[]` |
  | `allowLocalhostOrigins` | `boolean` | `NO` | `true` |

  camelCase, matching the Prisma field names exactly — the schema declares no
  column-level `@map`, so snake_case here would have broken every query.

- Additive, both columns defaulted, no backfill: safe on a live database.

**Status: authored, validated, not applied to production.** The production
database was not touched. Applying it is the existing migration job's
business (`infrastructure/azure/12-migrate-job.sh`).

## 5. HTTP CORS — PASS (local build)

`OPTIONS` preflights against `http://localhost:4199` with
`CORS_ORIGIN=http://localhost:3001`:

| Route | Origin | `Access-Control-Allow-Origin` |
| --- | --- | --- |
| `/v1/rooms` | `http://localhost:3001` | reflected |
| `/v1/rooms` | `http://localhost:3000` | absent — blocked |
| `/v1/rooms` | `https://evil.example.com` | absent — blocked |
| `/v1/chat/conversations` | `http://localhost:3000` | reflected |
| `/v1/chat/conversations` | `https://evil.example.com` | reflected |
| `/v1/telemetry/rtc` | either | reflected |

The SDK surfaces reflecting any origin is the design, not a hole: those
routes carry no ambient authority, `Access-Control-Allow-Credentials` is
**absent** on all of them, and per-tenant enforcement happens after
authentication. See `apps/api/src/shared/config/cors-policy.ts`.

Credentials were **not** enabled. Livqeno's browser auth is a bearer token, not
a cookie.

## 6. Per-project origin enforcement — PASS (local build)

Project configured `allowedOrigins = [https://myapp.com, http://localhost:3000]`,
`allowLocalhostOrigins = true`. `GET /v1/chat/conversations/{id}/messages`
with a real chat token:

| `Origin` | Result |
| --- | --- |
| `http://localhost:3000` | 200 |
| `http://localhost:5173` | 200 — any loopback port |
| `https://myapp.com` | 200 |
| `http://myapp.com` | **403** — scheme is part of an origin |
| `https://sub.myapp.com` | **403** — no implicit subdomains |
| `https://evil.example.com` | **403** |
| *(header absent)* | 200 — server-side caller |

Write-boundary validation on `PATCH /v1/projects/{id}/allowed-origins`:
`https://*.example.com`, `*` and `https://app.example.com/login` are each
rejected 400 with the offending entry named. `HTTPS://MyApp.com:443`
normalises to `https://myapp.com` and de-duplicates.

Empty-list compatibility, and cache invalidation, in one sequence:

```
evil origin, list configured          403
PATCH allowedOrigins=[]               200
evil origin, immediately after        200   <- empty means unconfigured means open
PATCH allowedOrigins=[myapp.com]      200
evil origin, immediately after        403   <- re-restricted, no TTL wait
```

## 7. WebSocket origin + RTC revocation — PASS (local build)

Node `ws` client against `localhost:4199`, 10/10:

- Chat WS from an allowed origin — stays open.
- Chat WS from a disallowed origin — closed `4403 ORIGIN_NOT_ALLOWED`.
- RTC WS from an allowed origin — authenticated, open.
- RTC WS from a disallowed origin — closed `4001 ORIGIN_NOT_ALLOWED`.
- Revocation end to end: fresh token connects → `DELETE
  /v1/rooms/{roomId}/rtc-tokens/{tokenId}` returns `{revoked: true}` → the
  same token is refused, `4001 TOKEN_REVOKED`, with an `error` frame carrying
  the code before the close → a different token for the same room is
  unaffected → revoking twice still 200.

## 8. Browser — PASS (local build), 16/16

A page on `http://localhost:3010` loading the real `@ravenkash/chat` and
`@ravenkash/rtc` ESM builds, tokens minted server-side so no API key reached
the browser. Driven in Chrome.

Passing: chat grant minted; Chat REST history and conversation fetch over
real CORS; Alice and Bob both connected (**no `ORIGIN_NOT_ALLOWED`, no 4403**);
both joined; Alice sent, **Bob received**; the message present in REST
history; typing propagated; presence readable; Bob disconnected and
reconnected; delivery working after reconnect; RTC token minted and signaling
authorized; telemetry accepted (204).

Skipped: RTC room join — signaling authorized the connection, but no SFU is
registered against the scratch database. Not an authorization result.

**Deliberately disallowed origin.** With `allowLocalhostOrigins: false` and
`allowedOrigins: [https://myapp.com]`, the same page was refused on every
surface: Chat REST 403, Chat WS 4403, telemetry 403, and RTC signaling
`PERMISSION_DENIED` carrying *"This origin is not allowed for this project.
Add it under Project Settings, Security, Allowed Origins."*

The SDK bundles in `dist/` were **stale** on first run — they predated even
the `ORIGIN_NOT_ALLOWED` work, so the first attempt reported
`SIGNALING_ERROR`. After `pnpm --filter @ravenkash/rtc build` the same case
reported `PERMISSION_DENIED`. Worth knowing that a checked-in `dist` can lag
source far enough to change what a browser test appears to prove.

## 9. Hosted RTC media — PASS

Two participants in one page against **hosted** Livqeno and the production SFU.
This browser has no camera, so an animated `canvas.captureStream()` stood in
via a `getUserMedia` shim — a real encoded video track, and the only way to
exercise the publish direction at all here.

- A joined; an SFU was allocated.
- A published a video track.
- B joined; A discovered B in the roster; A's `camera` track appeared in B's.
- **A's peer connection sent 18,020 RTP bytes; B's received 11,459.** Media
  genuinely traversed the hosted SFU.
- Both left cleanly.

Transport state on the earlier single-participant run through the playground:
`ICE connected`, `Remote ICE connected`, `Remote peer connected`, 0 reconnects.

Two observations, neither a failure of this work:

- The publisher's peer connection sits in `signalingState:
  have-local-offer` — its publish renegotiation offer looks unanswered, even
  though media flows. Belongs to the SFU workstream.
- `trackSubscribed` / `trackPublished` did not fire on B, whose roster and
  RTP counters were both correct. B joined *after* A published, so this may
  be by design; not investigated further here.

## 10. Hosted deployment — three real gaps

Measured from a real browser at `http://localhost:3000`, and by `curl`.

1. **No CORS headers at all.** Every cross-origin request from the browser
   fails, including `/health`. `fetch(..., {mode: 'no-cors'})` succeeds with
   an opaque response, which is what proves the host is reachable and the
   failure is CORS rather than the network. No `Access-Control-Allow-Origin`
   for `http://localhost:3000`, `https://app.ravenstack.online`, or anything
   else tried, on either hostname. **Browser Chat REST and telemetry against
   hosted Livqeno do not work today.**

2. **Chat WebSocket refuses localhost, RTC WebSocket checks nothing.** The
   chat gateway closes `4403 ORIGIN_NOT_ALLOWED` with the message *"This
   origin is not allowed to open a chat connection"* — the wording at
   `HEAD`, gating on the deployment-wide `CORS_ORIGIN` list rather than on
   the project. The RTC gateway, on the same non-allowlisted origin, **stayed
   open**: it does not look at `Origin` at all in the deployed build. That is
   the gap the working tree closes.

3. **`API_PUBLIC_URL` is misconfigured.** Grants hand the browser
   `raven-api.salmontree-6311a7e1.eastasia.azurecontainerapps.io` as
   `chatUrl`/`apiUrl`/`endpoint` instead of `api.ravenstack.online`, exposing
   the raw Azure Container Apps hostname to clients.

None of the working-tree changes in this pass are deployed. The deployed
image predates them.

## 11. Quality gate

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `tsc --noEmit` (api, dashboard, sdk) | PASS |
| `pnpm docs:verify` | PASS — 142 pages, no drift |
| `prisma validate` | PASS |
| unit suites (10 packages) | PASS — 1,724 tests |
| `test:e2e` | PASS — 192 tests |
| `pnpm format:check` | **FAIL, pre-existing** |

`format:check` flags 354 files, **324 of which this work never touched** — it
was already failing repo-wide. The five files created here were formatted and
verified clean individually; the other 324 were left alone rather than
swept into an unrelated 350-file reformat.

## 12. Not verified

- Chat token revocation has no public endpoint, so `TOKEN_REVOKED` on the
  chat side stays reachable in principle and untriggerable in practice.
- Screen sharing, and audio media specifically — the harness publishes video
  only, there being no synthetic microphone.
- Live Streaming end to end in a browser. Its authorization was reviewed and
  is covered by 34 existing unit tests, including that a viewer token cannot
  widen itself and that cross-project access 404s.
- Any behaviour of the working tree *as deployed*, since it is not deployed.
