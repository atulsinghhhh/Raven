---
title: Running the SFU
description: How a media server joins the fleet, how rooms are allocated to it, and how to take one out of service.
---

The SFU is a Go service built on Pion. It forwards media and nothing else —
it holds no database and issues no credentials.

## How a node joins

A node registers itself with the control plane and then heartbeats:

```
POST /v1/rtc/servers/register           on start-up
PUT  /v1/rtc/servers/{name}/heartbeat   on an interval
```

Both are authenticated with `SFU_REGISTRATION_SECRET` — a server-to-server
secret, never handed to a client and never the same value as any
client-facing token secret.

A node that has not heartbeated within `SFU_HEARTBEAT_TIMEOUT_SECONDS` (30
by default) is treated as unhealthy and stops receiving new rooms. That
window must comfortably exceed the node's own heartbeat interval or healthy
nodes flap.

## How rooms are allocated

When the first participant joins a room, the control plane picks a node:
preferring the requested region, and **falling back to any region rather
than failing the call**.

That fallback is worth knowing about, because it has a sharp edge on a
shared database — see [Known limitations](/reference/known-limitations).

Clients never learn which node they got. They connect to the signaling
endpoint and Livqeno negotiates on their behalf. That indirection is what
allowed Livqeno's media plane to be replaced wholesale without an SDK
release.

## Configuration

| Variable | What it is |
|---|---|
| `SFU_NODE_ID` | This node's name in the fleet |
| `SFU_REGION` | Region label used for allocation |
| `SFU_PUBLIC_IP` / `SFU_PUBLIC_HOST` | What clients can actually reach |
| `SFU_UDP_PORT_MIN` / `SFU_UDP_PORT_MAX` | Media port range — must be open |
| `SFU_ROOM_CAPACITY` | Rooms this node will accept |
| `SFU_HTTP_PORT` | Its own health and metrics port |
| `SFU_CONTROL_PLANE_URL` | Where to register and heartbeat |
| `SFU_DEFAULT_REGION` | *Control plane* setting: region used when none is requested |

`SFU_PUBLIC_IP` being wrong is the classic failure: allocation succeeds,
the client is handed an address nothing can reach, and the call fails with
no obvious cause.

## Inspect the fleet

```bash
raven rtc servers list
raven rtc servers get <server>
raven rtc rooms list
raven rtc participants list <room>
raven rtc diagnostics <room>
```

## Draining a node

Before a deploy or a shutdown, stop new rooms without dropping live ones:

```bash
raven rtc servers drain <server>
```

Existing rooms keep running; no new ones are allocated. Wait for it to
empty, then take it out. Bring it back with the undrain endpoint —
`POST /v1/rtc/servers/{name}/undrain`.

## Its own health

The SFU serves its own `/readyz`. One thing to expect: it reports
`nodeLinks: 0` and `ready: false` at idle, because a link to the control
plane is established when a room actually needs one. That is not a fault at
rest.

## Graceful shutdown

The control plane installs shutdown hooks, so SIGTERM drains connections
rather than dropping them: both gateways close every socket with a distinct
code instead of an unannounced cut, the webhook worker stops polling, and
Postgres and Redis disconnect cleanly.

Pair that with a preStop delay in your orchestrator so clients notice the
pod leaving the service's endpoints and start reconnecting elsewhere before
the process exits.

## Next steps

- [Health & metrics](/self-hosting/health-and-metrics) — the SFU's metrics.
- [TURN & NAT traversal](/self-hosting/turn) · [Known limitations](/reference/known-limitations)
