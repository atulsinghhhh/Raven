# Node.js backend example — `@ravenkash/server`

The Phase 10 quickstart: a real Express server that mints RTC tokens for
your frontend, using `@ravenkash/server`. `RAVEN_API_KEY` never leaves this
process — the browser only ever sees a short-lived RTC token.

## Running it

```bash
# From the repo root: build the SDK this example depends on
pnpm --filter @ravenkash/server build

cd examples/node-server
npm install     # resolves @ravenkash/server via a local file: dependency
RAVEN_API_KEY=rvk_xxxx.yyyy npm start
# → Raven node-server example listening on http://localhost:8787
```

Get a real `RAVEN_API_KEY` via `raven keys create` (see `docs/cli.md`) or
the dashboard's API Keys tab.

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
    → Raven Control API (authenticated by RAVEN_API_KEY, never sent to the browser)
      → a short-lived RTC token
  ← back to the browser
Browser: createRTCClient({ token, endpoint, iceServers }).join(room)
```

See `docs/sdk/server/typescript.md` and `docs/security/server-sdk.md` for
the full authorization model and security notes.
