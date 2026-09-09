# Server SDK security model

Applies to both `@ravenkash/server` (TypeScript) and `raven-sdk` (Python).

## Three separate authentication layers — never confuse them

```
Your application's authentication   (your users log into your app)
        ≠
Raven API authentication            (your backend ↔ Raven, via a permanent API key)
        ≠
RTC participant authentication      (a browser ↔ Raven RTC, via a short-lived token)
```

```
User logged into your app
    │
    ▼
Your backend checks your own app's permission for this user
    │
    ▼
Your backend calls raven.tokens.create({ room, identity })  (Raven API key — server-only)
    │
    ▼
Raven mints a short-lived RTC token
    │
    ▼
Browser uses that RTC token with @ravenkash/rtc — never a Raven API key
```

**The browser must never be able to request an arbitrary Raven token.**
Your backend decides `identity` (and permissions) from its own
authenticated session — never from an unchecked value the client sent.
See the `identity` comment in `examples/node-server/server.js` and
`examples/python-server/main.py`.

## API key storage

- A Raven API key (`rvk_xxxx.yyyy`) is a permanent, project-scoped
  credential — treat it like a database password.
- Store it in your backend's own secret management (environment
  variable, secrets manager) — **never** in source control, never in a
  frontend bundle, never in a mobile app binary.
- Both SDKs require it to be passed explicitly
  (`apiKey: process.env.RAVEN_API_KEY` / `api_key=os.environ["RAVEN_API_KEY"]`)
  — **neither SDK reads any environment variable automatically.** This
  is deliberate: implicit env scanning is exactly the kind of behavior
  that causes a key to be picked up from the wrong place.

## What the SDKs guarantee

- The API key lives only in a private field
  (`#apiKey` in TypeScript; a name-mangled attribute in Python) — never
  a plain object property, never enumerable, never included in
  `JSON.stringify()`/`repr()`/`vars()` of the client.
- Never logged by the SDK itself, at any point, in any mode (there is no
  debug/verbose logging mode in this phase that could accidentally log
  a header).
- Never included in a thrown/raised error. `RavenError` is built only
  from the parsed response body (`{message, code}`) and response
  metadata (status, `x-request-id`) — never from request internals.
- Never serialized into any object either SDK returns.

Verified by dedicated redaction tests in both SDKs (`test/http-client.spec.ts`'s
"secret redaction" suite; `tests/test_http_client.py`'s and
`tests/test_client.py`'s equivalents) — constructing a client with an
obviously-identifiable fake secret and asserting it never appears in
`repr()`/`toString()`/`JSON.stringify()`/a raised error, including after
a real (mocked) 400 response.

## Short-lived RTC tokens

- `raven.tokens.create(...)` always returns a token with a real
  expiration (`expiresIn`/`expires_in`, capped server-side at 6 hours,
  no way to request a permanent one).
- **Recommendation: keep `expiresIn` as short as your UX allows** — long
  enough to cover a call, not longer. A token only grants what its
  `permissions` say (join/subscribe/publish/publishAudio/publishVideo/
  publishData) — request the minimum your use case needs.
- Never log a minted token. Never store one longer than it takes to
  forward it to the browser that will use it.

## Backend authorization — your responsibility, not Raven's

Raven's API key proves your *backend* is allowed to talk to Raven. It
says nothing about which of *your* users should be allowed to join
which room as which identity — that's your application's own
authorization logic, applied before calling `raven.tokens.create(...)`.
Never let a request body's `identity`/`room` go straight into a token
mint without your own check.

## Logging

Neither SDK writes any log output by default (no debug mode exists in
this phase). If you log requests/responses in your own application code
around these SDKs, redact the `Authorization` header and the response
body of `tokens.create()` the same way you would for any other secret —
the SDKs cannot prevent your own logging code from choosing to log a
value it explicitly holds.

## What Raven itself never logs

Carried over from Phases 8/9's own audits, still true here: the Control
API's request logging middleware never logs headers or bodies (only
method/path/status/duration + a request ID), and telemetry ingestion
never logs response bodies either. See `docs/cli.md#security` and
`docs/observability.md#security--redaction`.

## Secret management summary

| Secret | Where it lives | Lifetime |
|---|---|---|
| Raven API key | Your backend's env/secrets manager only | Permanent (until revoked via `raven keys revoke`) |
| RTC token | Backend → browser, in-memory only | Minutes to hours (`expiresIn`) |
| TURN credentials | Embedded in the RTC token's `iceServers`, browser-only | Same lifetime as the RTC token |

Nothing above the RTC-token row should ever reach a browser.
