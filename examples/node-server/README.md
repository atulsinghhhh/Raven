# Node.js backend example — `@ravenkash/server`

The Phase 10 quickstart: a real Express server that mints RTC tokens for
your frontend, using `@ravenkash/server`. `RAVEN_API_KEY` never leaves this
process — the browser only ever sees a short-lived RTC token.

## Running it

Sign up for a Raven Cloud project at the
[dashboard](https://app.ravenstack.online) and create an API key from the
project's API Keys tab (or `raven keys create` — see `docs/cli.md`).

```bash
cd examples/node-server
npm install     # installs @ravenkash/server from npm
RAVEN_API_KEY=rvk_xxxx.yyyy RAVEN_API_URL=https://api.ravenstack.online npm start
# → Livqeno node-server example listening on http://localhost:8787
```

## Try it

```bash
curl -X POST http://localhost:8787/api/rtc/token \
  -H "Content-Type: application/json" \
  -d '{"room": "<a real room ID from raven rooms create>", "identity": "alice"}'
```

Returns the same shape `POST /v1/rooms/:roomId/rtc-tokens` does —
`{ token, endpoint, iceServers, telemetryUrl, expiresAt, ... }` — pass
that straight into `createRTCClient()` from `@ravenkash/rtc` on the frontend
(see `examples/video-call`).

## The full flow this demonstrates

```
Browser: fetch('/api/rtc/token', { method: 'POST', body: { room, identity } })
  → this server: raven.tokens.create({ room, identity, permissions })
    → Livqeno Control API (authenticated by RAVEN_API_KEY, never sent to the browser)
      → a short-lived RTC token
  ← back to the browser
Browser: createRTCClient({ token, endpoint, iceServers }).join(room)
```

See `docs/sdk/server/typescript.md` and `docs/security/server-sdk.md` for
the full authorization model and security notes.
