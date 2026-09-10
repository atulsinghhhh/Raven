---
title: TURN & NAT traversal
description: Why a relay is not optional, how credentials are minted, and the configuration that gets it wrong.
---

TURN is the difference between calls that work everywhere and calls that
work on your laptop.

## Why it is not optional

Two clients can only exchange media directly if the network lets them. On a
corporate network, a symmetric NAT, or a mobile carrier, it often does not.
A TURN server relays the media instead.

Without a working relay, a share of your users — the share you cannot
predict — get calls that connect and then carry nothing.

## How credentials work

You do not issue TURN credentials. Livqeno does, per token:

```
POST /v1/rooms/{roomId}/rtc-tokens
   → { token, endpoint, iceServers: [ … ], … }
```

`iceServers` carries STUN and TURN entries with a username and credential
minted from `TURN_SECRET` and scoped to that token's lifetime.

**Forward it untouched.** No client should ever hold a long-lived relay
credential, and nothing should hand-build this array:

```ts
const client = createRTCClient({
  token: credentials.token,
  endpoint: credentials.endpoint,
  iceServers: credentials.iceServers,   // as-is
});
```

## Configuration

| Variable | What it is |
|---|---|
| `TURN_HOST` | **Host-facing** address clients will actually dial |
| `TURN_PORT` | Usually 3478 |
| `TURN_TLS_PORT` | Only set it if coturn has a real certificate; advertises `turns:` |
| `TURN_SECRET` | Shared secret credentials are derived from |
| `TURN_INTERNAL_HOST` | The address the API's own health probe uses — the Docker service name |

`TURN_HOST` and `TURN_INTERNAL_HOST` are separate on purpose and mixing
them up is the most common failure. The health check runs *inside* the API
container, so it wants `coturn`. A browser wants a public hostname. Put a
container name in `TURN_HOST` and every client silently fails to reach the
relay while your health check stays green.

## Ports

Open at the firewall:

- **3478/udp and 3478/tcp** — TURN and STUN.
- **5349/tcp** — `turns:` over TLS, if configured.
- **The relay range/udp** — the ports coturn hands out for actual media.
  A relay range that is closed means allocation succeeds and media does not
  arrive, which is a genuinely confusing failure.

## Verify, do not assume

```bash
raven diagnostics
```

Reports whether the API can reach each dependency, TURN included. For the
media path itself, the repository ships a relay test:

```bash
scripts/turn-relay-test.sh                    # TURN over UDP
scripts/turn-relay-test.sh --transport tcp    # TURN over TCP
```

That forces two clients to be relay-only and pushes real RTP through
coturn — the only evidence that counts.

## Verified and not verified

Stated because "TURN works" is a claim that needs evidence:

| Path | Status |
|---|---|
| TURN relay over UDP | Tested, automated |
| TURN relay over TCP | Tested, automated |
| `turns:` over TLS, end to end | **Not tested** — the local certificate is self-signed, which Pion rejects for the same reason a browser would. Server-side TLS is verified separately |
| Symmetric NAT on both sides | Relay path tested; the NAT itself is not — relay-only is forced by policy, not by a NAT that left no alternative |

## A relay that fails open is worse than one that fails

coturn's behaviour with an unreadable configuration file is to start
without it — which can mean an open relay. Treat a coturn config parse
error as a hard failure in your own deployment tooling. See
[Known limitations](/reference/known-limitations).

## Next steps

- [Environment variables](/self-hosting/environment-variables)
- [Handle reconnection](/guides/handle-reconnection) — where relays matter most.
- [RTC troubleshooting](/rtc/troubleshooting)
