# Chat audit harness

An **external developer's** view of Livqeno Chat. Nothing in here imports from
`apps/api`; every phase talks to a running API over plain HTTP and WebSocket,
and Phase 12/14 go through the published SDK packages exactly as a third party
would. That is the point — the repo's own e2e suite boots `AppModule` in
process, which can only ever prove the code agrees with itself.

## Isolated environment (required)

These phases delete Redis, restart the gateway and write ~200k rows. Never aim
them at a shared database. `.env`'s `DATABASE_URL` points at Supabase.

```bash
docker run --rm -d --name raven-chat-audit-redis -p 6399:6379 redis:7-alpine
docker run --rm -d --name raven-e2e-pg -p 55432:5432 \
  -e POSTGRES_PASSWORD=test postgres:16-alpine

export DATABASE_URL="postgresql://postgres:test@localhost:55432/postgres"
export DIRECT_URL="$DATABASE_URL"
export REDIS_URL="redis://localhost:6399"
export API_PORT=4177 PUBLIC_URL="http://localhost:4177"
export JWT_SECRET=... CHAT_TOKEN_SECRET=... RTC_TOKEN_SECRET=...

pnpm --filter @raven/api prisma:migrate:deploy
pnpm --filter @raven/api exec nest build
(cd apps/api && node dist/main.js &)
```

Phases 9 and 13 measure reliability, not rate limiting, so raise the chat
limits for those runs (`CHAT_SEND_RATE_LIMIT=100000`, etc.). The limiter itself
is verified separately at its defaults in Phase 9.

## Running

```bash
cd scripts/chat-audit/harness
ln -s ../../../node_modules/ws node_modules/ws          # plus @ravenkash/* links
node bootstrap.mjs                                       # writes ctx.json
node phase2.mjs && node phase3.mjs && ...
```

`phase15.mjs` covers automatic missed-message recovery end to end and needs
`API_CWD` set (it restarts the gateway):

```bash
API_CWD=../../../apps/api node phase15.mjs
```

It sends through a chat token rather than the project API key on purpose:
API-key auth bcrypt-verifies on every request (~100 ms), so seeding 250
messages through it takes ~25 s — long enough that the client under test
reconnects mid-seed and receives them live, which tests the wrong path.

`perf-recovery.mjs` measures what recovery costs: per-message frame growth
and the latency of a catch-up request.

Phase 14 needs a browser and the standalone app:

```bash
cd ../thirdparty-app
RAVEN_BASE=http://localhost:4177 RAVEN_API_KEY=... RAVEN_ROOM=conv_... node server.mjs
# then open http://localhost:5199/?user=alice and ?user=bob
```

`thirdparty-app` is deliberately minimal and uses **only** `@ravenkash/chat`:
no dashboard code, no Playground, no internal hooks. Its backend knows exactly
one Livqeno endpoint, `POST /v1/chat/tokens`.
