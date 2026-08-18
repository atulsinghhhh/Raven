# Error codes and classification

This document covers two separate vocabularies: the **RTC** error categories
(classified server-side from telemetry) and the **Chat** error codes (returned
directly by the chat API and SDK). They are deliberately distinct — a chat
failure and a media failure have almost nothing in common, and merging them
would produce a category list that describes neither well.

## RTC errors

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


---

# Chat error codes

Every failure from the chat API or `@raven/chat` carries one of these codes.
They are stable, and they map one-to-one onto SDK error classes so a caller
can branch on the class rather than string-matching a message.

Raw infrastructure errors never reach a client: a Postgres constraint
violation, a Redis timeout, or an unhandled exception is logged server-side in
full and surfaces as `INTERNAL_ERROR`.

| Code | HTTP | SDK class | Meaning |
|---|---|---|---|
| `INVALID_TOKEN` | 401 | `RavenChatAuthenticationError` | Missing, malformed, or wrongly-signed chat token. |
| `TOKEN_EXPIRED` | 401 | `RavenChatAuthenticationError` | The token expired — mint a new one. |
| `TOKEN_REVOKED` | 401 | `RavenChatAuthenticationError` | Revoked before its natural expiry. |
| `UNAUTHORIZED` | 401 | `RavenChatAuthenticationError` | No usable credential presented. |
| `PERMISSION_DENIED` | 403 | `RavenChatPermissionError` | Authenticated, but the scope or role doesn't allow this. |
| `NOT_A_MEMBER` | 403 | `RavenChatPermissionError` | Not a member of that conversation. |
| `ORIGIN_NOT_ALLOWED` | 403 | `RavenChatPermissionError` | The upgrade's `Origin` isn't in `CORS_ORIGIN`. |
| `ROOM_NOT_FOUND` | 404 | `RavenRoomError` | No such conversation in this project. |
| `NOT_IN_ROOM` | 400 | `RavenRoomError` | This connection isn't subscribed to that room. |
| `TOO_MANY_SUBSCRIPTIONS` | 400 | `RavenRoomError` | Per-connection room subscription limit reached. |
| `CONVERSATION_ARCHIVED` | 409 | `RavenRoomError` | Writes are closed; reads still work. |
| `MESSAGE_NOT_FOUND` | 404 | `RavenMessageError` | No such message in this project. |
| `MESSAGE_DELETED` | 409 | `RavenMessageError` | The message is soft-deleted. |
| `MESSAGE_TOO_LARGE` | 413 | `RavenMessageError` | Text, metadata, or frame exceeded its limit. |
| `INVALID_MESSAGE` | 400 | `RavenMessageError` | Malformed or missing a required field. |
| `INVALID_MESSAGE_TYPE` | 400 | `RavenMessageError` | Unsupported frame or message type. |
| `INVALID_CURSOR` | 400 | `RavenMessageError` | Pagination cursor is malformed. |
| `RATE_LIMITED` | 429 | `RavenRateLimitError` | A limit was exceeded; carries `retryAfterSeconds`. |
| `ATTACHMENT_NOT_FOUND` | 404 | `RavenAttachmentError` | No such attachment, or not yet uploaded. |
| `ATTACHMENTS_NOT_CONFIGURED` | 501 | `RavenAttachmentError` | No object storage configured on this deployment. |
| `ATTACHMENT_TOO_LARGE` | 413 | `RavenAttachmentError` | Over `STORAGE_MAX_ATTACHMENT_BYTES`. |
| `CONNECTION_FAILED` | — | `RavenChatConnectionError` | Could not connect, or reconnects were exhausted. |
| `CONNECTION_CLOSED` | — | `RavenChatConnectionError` | The socket closed before the server replied. |
| `NETWORK_ERROR` | — | `RavenChatConnectionError` | The request never reached Raven. |
| `TIMEOUT` | — | `RavenChatConnectionError` | No server response within `requestTimeoutMs`. |
| `INTERNAL_ERROR` | 500 | `RavenChatError` | Something failed on Raven's side; logged server-side. |

An unrecognised code (from a newer server) becomes a base `RavenChatError`
with that code preserved, rather than an exception — an older client keeps
working across a server upgrade.

## WebSocket close codes

| Code | Meaning | Reconnect? |
|---|---|---|
| `1000` | Normal closure | No |
| `4401` | Authentication failed | **No** — retrying can't help |
| `4403` | Origin not allowed | **No** |
| `4429` | Connection rate limit | Yes, after backing off |
| `4440` | Token expired | Yes, with a fresh token |
| `4500` | Server shutting down | Yes, immediately |

## Where to see this

- Dashboard → a project's **Chat** section
- `@raven/chat`'s `error` event and rejected promises
- `docs/chat/websocket.md` for the frame-level contract
