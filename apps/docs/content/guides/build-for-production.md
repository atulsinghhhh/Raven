---
title: Build for production
description: The work between a demo that runs and a deployment that survives users.
---

## What we're building

Not a feature — the gap between the two. Secrets handled properly, tokens
minted with the right lifetime, TURN reachable, webhooks verified,
monitoring in place, and honesty about what Raven has not proven yet.

## Prerequisites

- A working integration of at least one product.
- Somewhere to deploy a backend, and a place to keep secrets.

## Implementation

### 1. Separate your environments for real

Use a **production** API key in production and a **development** key
everywhere else. The environment is baked into the key, so this is the
cheapest isolation you will ever get:

```bash
raven keys create --name backend-prod --environment production
raven keys create --name backend-dev  --environment development
```

Never let a production key into a developer's shell. See
[Environments](/production/environments).

### 2. Get secrets out of your repository

Five secrets matter, and none belongs in source control:

| Secret | Held by |
|---|---|
| `RAVEN_API_KEY` | Your backend only |
| `RAVEN_WEBHOOK_SECRET` | Your webhook receiver only |
| `JWT_SECRET`, `RTC_TOKEN_SECRET`, `CHAT_TOKEN_SECRET` | Your Raven deployment, if self-hosting |

If you self-host, generate each independently:

```bash
openssl rand -hex 32
```

Self-hosted deployments must set `RTC_TOKEN_SECRET` and `CHAT_TOKEN_SECRET`
explicitly. They fall back to `JWT_SECRET` so a fresh clone boots, and
production validation refuses that fallback at start-up — one secret must
not be able to mint another's credentials.

### 3. Mint short tokens, and refresh them

```ts
const credentials = await raven.tokens.create({
  room: room.id,
  identity: user.id,
  permissions: { join: true, subscribe: true, publish: true },
  expiresIn: 600,                 // not 21600 because you can
});
```

Keep the lifetime short. A token *can* be revoked before it expires
(`DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}`), but revocation only
blocks new connections — it does not hang up a call already in progress —
so the lifetime is still the control that bounds a leak. Ten minutes is
plenty; the SDK holds the connection open past expiry, and a reconnect
mints a fresh one from your endpoint. See
[RTC authentication](/rtc/authentication#revocation).

For chat, wire the refresh callback. This is the most common production
chat bug:

```ts
createChatClient({
  token,
  apiUrl,
  onTokenExpiring: async () => (await fetch('/chat-token').then((r) => r.json())).token,
});
```

### 4. HTTPS and WSS everywhere

`https://` for the API, `wss://` for both sockets. A chat token travels in
the WebSocket URL because no browser can set headers on an upgrade — over
cleartext that is a credential in cleartext.

Set `CORS_ORIGIN` to your actual origins. Not `*`:

```
CORS_ORIGIN=https://app.example.com,https://admin.example.com
```

The chat gateway rejects a mismatched `Origin` with close code `4403`.

### 5. Make TURN work, then prove it

TURN is what makes calls connect on corporate networks and mobile. If it is
misconfigured, failures look random and land on symmetric-NAT users only.

- Serve `turn:` on 3478 and, if you have a real certificate, `turns:` too.
- Reachable UDP relay range, opened at the firewall.
- Forward `iceServers` from the mint response **untouched** — those
  credentials are minted per token and expire with it.

Then check it actually relays, rather than assuming:

```bash
raven diagnostics
```

See [TURN & NAT traversal](/self-hosting/turn).

### 6. Verify webhooks, and watch the deliveries

Verification is covered in [Handle webhooks](/guides/handle-webhooks). The
operational half is watching them:

```bash
curl "$RAVEN_API_URL/v1/projects/$PROJECT_ID/webhooks/$WEBHOOK_ID/deliveries" \
  -H "Authorization: Bearer $RAVEN_TOKEN"
```

An endpoint that hit 50 consecutive failures is auto-disabled. Without a
check on that, it is silent data loss.

### 7. Wire up monitoring

Three surfaces, all real rather than synthetic:

```bash
raven status                    # dependency health
raven connections list          # what connected, and how it ended
raven errors list               # classified failures with likely causes
raven diagnostics               # is the whole stack reachable
```

If you self-host, scrape `/metrics` and probe `/health/ready` — see
[Health & metrics](/self-hosting/health-and-metrics).

Alert on the rate of `FAILED` connections rather than on any single
failure. One failed call is a bad network; a rising rate is your problem.

### 8. Know your limits before you meet them

Defaults worth knowing: 50 participants per room, 4000-character messages,
25 MB attachments, 60 token mints per window, chat sends at 30 per 10
seconds per user. Full table in [Limits & quotas](/reference/limits).

## How it works

**Nothing about production changes the API.** Every control above is a
credential, a configuration value, or an operational check. There is no
"production mode" to enable, which means there is no switch to forget.

**The credential model is the security model.** A short-lived, narrowly
scoped token in a browser and a permanent key on a server is the whole
design. Most production incidents in real-time products come from getting
that one boundary wrong.

## Production considerations

Not everything is ready, and these are stated rather than discovered:

| Area | Status |
|---|---|
| Congestion control | TWCC feedback is collected; nothing consumes it to drive layer selection |
| Server-side quality verdict | `getConnectionQuality()` returns `'unknown'` rather than guessing |
| Simulcast on AV1 / H.265 | Keyframe detection covers VP8, VP9, H.264 only |
| Browser coverage | Only Chromium exercised with real media |
| Measured capacity | 100 participants on loopback with synthetic media — not a capacity figure |
| Recording | Does not exist |
| Usage metering / billing | Does not exist |

The full list, with what each one means for you, is in
[Known limitations](/reference/known-limitations). Read it before you commit
to a launch date.

## Next steps

- [Production checklist](/production/checklist) — the same content as a list you can tick off.
- [Security](/authentication/security) · [Limits & quotas](/reference/limits)
- [Self-hosting](/self-hosting) — if you run Raven yourself.
