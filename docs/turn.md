# TURN (coturn) — Operations Reference

This is the operational reference for Raven's TURN/STUN deployment: exact
configuration, authentication mechanism, ports, TLS, abuse protection,
metrics, and a production checklist. For *why* TURN exists at all and how
it fits alongside the SFU at a design level, see
[docs/architecture/turn.md](architecture/turn.md). For the end-to-end
NAT-traversal flow (STUN → ICE → TURN → SFU) and connection-type
observability, see [docs/rtc/networking.md](rtc/networking.md).

## Architecture

coturn is deployed as an independent Docker Compose service
(`infrastructure/docker/coturn/`), separate from the SFU. The SFU embeds
no TURN server of its own — an SFU that also relays is two capacity
problems sharing one process, and coturn needs to scale and fail
independently of the media plane.

The **control plane** owns credential issuance, not the SFU: a fresh
time-limited credential is minted per RTC token, so its lifetime is tied
to the same access-control surface as everything else in that token. A
client therefore never holds a permanent relay credential, and a leaked
one expires on its own.

```
turnserver.conf (non-secret, static config)
        +
CLI flags in docker-compose.yml (secrets + values needing .env interpolation)
        |
        v
     coturn container (raven-network)
        ^
        |
  iceServers in a minted RTC token (turn-credential.util.ts)
        |
        v
      browser client
```

**Why config is split between the conf file and CLI flags:** the conf file
is mounted as a static, read-only volume — coturn reads it literally, with
no `${VAR}` shell expansion. Any value that needs to come from `.env` (the
shared secret, quotas, Prometheus port) is passed as a `command:` CLI flag
in `docker-compose.yml` instead, since Compose *does* interpolate `${VAR}`
in the `command:` array. This was learned the hard way in Phase 1 and
re-confirmed while adding Phase 5's quota/metrics flags.

## Authentication

coturn's `use-auth-secret` (REST API / time-limited credential) mechanism,
**not** `lt-cred-mech`'s static long-term username/password database — the
two are mutually exclusive auth backends, and coturn logs an explicit
startup warning if both are configured ("shared secret overrides").

Credential scheme (implemented in
`apps/api/src/modules/rtc-tokens/turn-credential.util.ts`):

- `username = "<unix-expiry-timestamp>:<participant-identity>"`
- `credential = base64(HMAC-SHA1(TURN_SECRET, username))`

coturn independently recomputes this HMAC when a client attempts to
allocate, and rejects allocation once `unix-expiry` has passed. There is no
separate credential store to manage — anyone who knows `TURN_SECRET` can
mint a valid credential, so that secret is treated with the same care as
`JWT_SECRET` (env-var only, never committed, rotated independently of any
live session).

Credential TTL is tied to the RTC token's own `ttlSeconds` (same value,
same expiry) — a TURN credential never outlives the access token it was
issued alongside.

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| `TURN_PORT` (default 3478) | UDP + TCP | STUN/TURN control channel (allocate, refresh, permissions) |
| `TURN_TLS_PORT` (default 5349) | TCP | TURNS — TURN control channel over TLS |
| `TURN_TLS_PORT` (default 5349) | UDP | TURN control channel over DTLS (requires coturn's `--dtls` flag in addition to a configured cert — TURNS-over-TCP alone does not enable it) |
| `TURN_MIN_PORT`–`TURN_MAX_PORT` (default 49160–49200) | UDP | Relayed media — one port per active allocation |
| `TURN_PROMETHEUS_PORT` (default 9641) | TCP | `/metrics` — **local dev convenience only, never expose in production** |

The relay port range is deliberately small and bounded (41 ports) for local
dev, matching the ports actually published in `docker-compose.yml`. A
production deployment sizes this range to expected concurrent-relayed-session
count (each active relayed participant holds one port for the session
duration) and opens it in the firewall — see
[Production checklist](#production-checklist).

## TLS (TURNS / DTLS)

- **Local dev:** `scripts/generate-turn-cert.sh` generates a self-signed
  RSA-2048 cert (`CN=localhost`, `SAN=DNS:localhost,IP:127.0.0.1`, 365-day
  validity) into `infrastructure/docker/coturn/certs/` (gitignored, never
  committed). This proves the TLS/DTLS *server-side* configuration is
  correct — verified directly with `turnutils_uclient -S` (TLS) and
  `turnutils_uclient -S -y` (DTLS over UDP), both showing real
  TLSv1.3/DTLSv1.2 handshakes — but browsers reject self-signed certs for
  `turns:` by default, so it does **not** prove an end-to-end browser TLS
  relay (see [Known limitations](#known-limitations)).
- **Production:** requires a real CA-issued certificate for the TURN
  server's actual public hostname (e.g. via Let's Encrypt/ACME), renewed
  before the cert's expiry (a cron/systemd-timer running `certbot renew`
  or equivalent — coturn does not renew certs itself and must be restarted
  or sent a config-reload after renewal). No explicit minimum-version flag
  is set — coturn 4.17.2 has no `no-tlsv1`/`no-tlsv1_1` directive (its
  `--tlsv1`/`--tlsv1_1` flags only *lower* the floor below the default, and
  are never passed here), and its default minimum is already TLS 1.2.
- coturn only exposes **one** `turns:` URL scheme:
  `turns:<host>:<port>?transport=tcp` (RFC 7065 does not define a
  `transport=udp` variant of `turns:`, even though DTLS-over-UDP is a real,
  separately-reachable coturn capability on the same `tls-listening-port`).

## Abuse protection

| Flag | Local dev default | Purpose |
|---|---|---|
| `--user-quota` | 10 | Max concurrent allocations per user (per TURN username) |
| `--total-quota` | 400 | Max concurrent allocations server-wide |
| `--max-bps` | 1,000,000 | Bandwidth cap per allocation (bytes/sec) |
| `no-multicast-peers` (conf file) | on | Refuse relaying to broadcast/multicast peer addresses |
| Time-limited credentials | — | No credential is valid beyond its `ttlSeconds` — bounds the blast radius of a leaked credential |
| `--allow-loopback-peers` | on | See [Known limitations](#known-limitations) — required for this Docker Compose topology, **do not carry into production** (coturn itself logs a warning: "opens a possible security vulnerability, do not use in production") |

There is no open relay: every allocation requires a valid, unexpired,
correctly-HMAC'd credential. Credential issuance is rate-limited upstream at
the RTC token endpoint (`RateLimit(60)` — 60 requests/window/IP), not inside
coturn itself.

## TURN usage metrics

coturn's built-in Prometheus exporter (`--prometheus`,
`--prometheus-port`) is enabled, exposing `/metrics` on
`TURN_PROMETHEUS_PORT` (default 9641). This gives allocation counts, active
sessions, traffic volume, and error counters as real counters (verified by
generating test traffic with `turnutils_uclient` and observing the counters
increment) — it is not a billing system, just the raw usage signal a
billing/observability layer would consume later.

**Never publish the Prometheus port outside the local dev/internal
network** — it has no authentication of its own.

## Testing

Automated tests (see `apps/api/src/modules/rtc-tokens/*.spec.ts` and
`apps/api/src/shared/config/env.validation.spec.ts`):

- TURN credential generation, expiry, and HMAC correctness.
- `iceServers` array correctness (right STUN/TURN/TURNS entries, matching
  credentials, never an internal Docker hostname).
- Unauthorized clients cannot obtain a valid TURN credential (API-key auth
  guard on the token endpoint).
- Invalid/missing production config fails startup (`validateEnv` /
  `validateProductionConfig`).

Manual verification (coturn's own documented test client, not a
custom-built harness):

```bash
# Control-channel handshake, TCP+TLS:
docker exec raven-coturn turnutils_uclient -t -S -W "$TURN_SECRET" -u "<expiry>:<label>" 127.0.0.1

# Real relayed-data path, TCP (client-to-client loopback mode):
docker exec raven-coturn turnutils_uclient -t -y -W "$TURN_SECRET" -u "<expiry>:<label>" 127.0.0.1

# Real relayed-data path, UDP (client-to-client loopback mode):
docker exec raven-coturn turnutils_uclient -y -W "$TURN_SECRET" -u "<expiry>:<label>" 127.0.0.1
```

The `-y` (client-to-client) runs verified 20/20 messages delivered (2000/2000
bytes), 0% loss, on both TCP and UDP transports — proof that coturn's
relay *data path* itself (not just the control channel) is functioning
correctly.

### Forced-relay media test (WebRTC end to end)

`scripts/turn-relay-test.sh` runs two real Pion clients with
`ICETransportPolicy: relay` against a real SFU and a real coturn, so the
only candidates either client gathers are TURN allocations. It asserts on
the nominated candidate pair (`local=relay` on both sides) and then reads
300 forwarded RTP packets off the subscriber's track — a connection that
came up over a host or STUN path fails the assertion rather than quietly
passing.

```bash
docker compose up -d coturn
scripts/turn-relay-test.sh                  # TURN over UDP, inside coturn's network
scripts/turn-relay-test.sh --transport tcp  # TURN over TCP
scripts/turn-relay-test.sh --host           # from the host, via the published port
```

All three pass. Artifacts land in `scripts/results/turn-relay-*.log`, and
the latency comparison against a direct path is in
[docs/rtc/test-matrix.md §5](rtc/test-matrix.md#relay-only-as-measured).
This is the test that makes the credential scheme above a wire-verified
claim rather than a unit-test one: coturn authenticates each allocation
against the HMAC it recomputes itself.

What it does not cover is a **browser** on a relay-only path, which is a
separate topology problem described next.

## Known limitations

**Forced-TURN-relay end-to-end *browser* test cannot be completed against
this local Docker Compose stack on Docker Desktop (macOS/Windows).**

Scope, since this section predates the forced-relay media test above and
was previously read as "relay-only is untestable locally": what cannot be
done locally is a **browser on the host** relaying to a **containerised
SFU**. Relay-only forwarding through the SFU *is* tested and passing —
`scripts/turn-relay-test.sh`, both transports, from inside the Docker
network and from the host — because there the client and the SFU sit on
the same side of the host/container boundary and every party sees one
consistent address for the SFU. The unresolved case below is specifically
the browser-plus-containerised-SFU split.

This limitation **survived the migration to Raven's own SFU unchanged**,
which is itself the useful finding: it was never about which SFU was
running. The analysis below was done against LiveKit and applies verbatim
to Raven's SFU, because the cause is the addressing topology, not the
media server.

Root cause: the SFU advertises `SFU_PUBLIC_IP=127.0.0.1` so a browser on
the host machine can reach it directly for host-candidate connections
(this is what makes the direct/STUN path work locally). When a client is
forced to relay-only (`iceTransportPolicy: 'relay'`), the SFU's ICE agent
must reach the browser's TURN-relayed candidate on coturn — and that part
works, confirmed via candidate-pair stats showing requests sent to
coturn's relay address. The **return path** fails: the browser only knows
the SFU's candidate as `127.0.0.1`, so it asks coturn to install a TURN
permission for peer `127.0.0.1` — but the SFU's actual outbound packets
arrive at coturn from its real container IP (confirmed via `netstat`
inside the container), a different address.

Per the TURN spec, coturn silently discards data from a peer address with
no matching permission, so nothing is relayed back. This reproduced
identically before and after adding `--allow-loopback-peers`, which rules
out a permission-*policy* problem and points at an address-*identity*
mismatch. A direct payload test confirmed Docker Desktop for Mac does not
route the container's bridge-network IP to the host at all — so no single
address is simultaneously valid for "browser on host reaches the SFU
directly" and "coturn, a peer container, correctly identifies the SFU's
traffic."

This is a Docker Desktop host/container networking limitation, not a defect
in Raven's TURN integration or credential/config logic — coturn's relay
engine itself is proven correct by the `turnutils_uclient` real-data tests
above, and the identical topology on a native Linux Docker host (where the
bridge network *is* directly routable from the host) would not hit this
address-identity conflict. **It also does not reflect a limitation of any
real deployment target**, where every party (client, TURN server, SFU) sees
one single, consistent, publicly routable address for the SFU — the
loopback/container split this bug depends on simply does not exist there.

## Production checklist

- [ ] Real CA-issued TLS certificate for the TURN server's public hostname,
      with an automated renewal job (coturn does not self-renew).
- [ ] `TURN_HOST` set to a real, publicly resolvable hostname — never
      `localhost` or an internal Docker service name (enforced at startup
      by `validateProductionConfig` when `NODE_ENV=production`).
- [ ] `TURN_TLS_PORT` set (enforced by `validateProductionConfig`).
- [ ] `--allow-loopback-peers` **removed** — it exists solely for this
      local dev topology and coturn itself flags it as a security risk.
- [ ] Relay port range sized to expected concurrent-session count and
      opened in the firewall/security group.
- [ ] `TURN_PROMETHEUS_PORT` **not** publicly exposed — scrape it from an
      internal network only.
- [ ] `TURN_SECRET` provisioned via real secret storage, rotated on a
      schedule independent of any deployment.
- [ ] Quotas (`TURN_USER_QUOTA`, `TURN_TOTAL_QUOTA`, `TURN_MAX_BPS`)
      re-tuned for production traffic, not left at local-dev-sized
      defaults.
- [ ] A real, end-to-end forced-relay **browser** test run against the
      actual production TURN hostname (not local Docker) to confirm what
      [Known limitations](#known-limitations) above could not prove
      locally. The Pion-client forced-relay test
      ([above](#forced-relay-media-test-webrtc-end-to-end)) already covers
      the SFU and credential side; what is left is a browser's ICE agent
      on a real network.
