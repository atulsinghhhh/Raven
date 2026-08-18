# Error codes and classification

Every RTC error a developer sees — in the dashboard, in `raven errors`,
or in an `@raven/rtc` `error` event — is a **Raven concept**, never a raw
LiveKit/coturn error code. `apps/api/src/modules/observability/error-classifier.ts`
is the one place that mapping lives.

## Categories

| Category | Meaning |
|---|---|
| `AUTHENTICATION_ERROR` | The caller's own identity/credential was rejected. |
| `AUTHORIZATION_ERROR` | Authenticated, but not allowed to do this (e.g. token lacks a permission). |
| `TOKEN_ERROR` | The RTC token itself was invalid, malformed, or expired. |
| `SIGNALING_ERROR` | The signaling handshake to the RTC endpoint didn't complete. |
| `ICE_ERROR` | ICE connectivity checks failed — usually a firewall/NAT restriction. |
| `TURN_ERROR` | A TURN relay connection specifically could not be established. |
| `SFU_ERROR` | The media server (LiveKit) couldn't complete the connection, for no more specific reason. |
| `NETWORK_ERROR` | A generic network-level failure or timeout. |
| `CLIENT_ERROR` | A local/application-side issue — wrong room, device permission, media error. |
| `UNKNOWN_ERROR` | Nothing more specific could be determined. |

## SDK error code → category mapping

| `@raven/rtc` `RTCErrorCode` | Category |
|---|---|
| `INVALID_TOKEN`, `TOKEN_EXPIRED` | `TOKEN_ERROR` |
| `PERMISSION_DENIED` | `AUTHORIZATION_ERROR` |
| `ROOM_NOT_FOUND` | `CLIENT_ERROR` |
| `CAMERA_PERMISSION_DENIED`, `MICROPHONE_PERMISSION_DENIED`, `DEVICE_NOT_FOUND`, `MEDIA_ERROR` | `CLIENT_ERROR` |
| `TIMEOUT`, `NETWORK_ERROR` | `NETWORK_ERROR` |
| `SIGNALING_ERROR` | `SIGNALING_ERROR` |
| `CONNECTION_FAILED` | `TURN_ERROR` / `ICE_ERROR` / `SIGNALING_ERROR` / `SFU_ERROR` — see below |
| anything else | `UNKNOWN_ERROR` |

`CONNECTION_FAILED` is context-dependent, checked in this order:

1. A `hint: 'turn_unreachable'` in the reported data → `TURN_ERROR`.
2. `iceConnectionState` of `failed`/`disconnected` → `ICE_ERROR`.
3. `signalingState` never reached `stable`/`connected` → `SIGNALING_ERROR`.
4. Otherwise → `SFU_ERROR` (no more specific signal available).

## Smart explanations — hedged, never certain

Every classified error carries a `likelyCause` and `suggestedAction` —
deliberately hedged language ("likely a firewall/NAT restriction"), never
a claim of certainty a Raven server can't actually back up. Examples:

- **`TOKEN_ERROR`**: *"The RTC token had already expired before (or
  during) the connection attempt."* → *"Mint a fresh RTC token — tokens
  are always short-lived by design."*
- **`ICE_ERROR`**: *"ICE connectivity checks failed between the client
  and the media server — likely a firewall/NAT restriction."* → *"Ensure
  TURN is reachable from this network; corporate proxies/firewalls are
  the most common cause."*
- **`TURN_ERROR`**: *"Unable to establish a TURN relay connection —
  possibly a restrictive firewall/NAT blocking UDP."* → *"Check whether
  UDP traffic is blocked; try a TCP/TLS TURN transport instead."*

## Where to see this

- `raven errors list` / `raven errors inspect <errorId>` (see `docs/cli.md`)
- Dashboard → a project's **Errors** tab and error detail page
- `GET /v1/projects/:projectId/errors` / `/errors/:errorId` (JWT-guarded)
