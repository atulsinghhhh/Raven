# Error codes and classification

Raven has three error vocabularies, and they are separate on purpose:

| Vocabulary | Where you see it | Why it is its own thing |
|---|---|---|
| **`RAVEN_*` codes** | The `code` field of any HTTP error body | One namespace for the whole REST API, so a single `switch` handles every endpoint |
| **RTC categories** | Dashboard, `raven errors`, telemetry | A *classification* of a failure that already happened, derived server-side from what the SDK reported — not a response code |
| **Chat frame codes** | The chat WebSocket `error` frame | A published wire protocol with its own lifetime; see [chat/websocket.md](chat/websocket.md) |

A chat failure and a media failure have almost nothing in common, and merging
them would produce a list that describes neither well.

---

# The HTTP error envelope

Every error the REST API returns has the same shape:

```json
{
  "code": "RAVEN_ROOM_NOT_FOUND",
  "legacyCode": "NOT_FOUND",
  "message": "Room not found",
  "requestId": "req_9f2c41ab77e0c3d5b1a4e8f2",
  "path": "/v1/rooms/room_missing"
}
```

| Field | Notes |
|---|---|
| `code` | The canonical code. Switch on this. |
| `legacyCode` | **Deprecated** — see below. |
| `message` | Human-readable, safe to log, never contains credentials or internals. |
| `requestId` | Quote this in a bug report. Also returned as the `x-request-id` header, always with the same value. |
| `path` | The route that produced the error. |

Some errors add fields — a 429 carries `retryAfterSeconds`, for example.
Unknown fields should be ignored rather than treated as an error.

## Request IDs

Every response carries `x-request-id`. Error bodies repeat it as `requestId`
so a developer copying a JSON blob into an issue does not lose it.

**Send your own** and Raven will adopt it, letting one call be traced across
your logs and ours:

```
x-request-id: 7c1f9e2a-your-own-correlation-id
```

An inbound value is accepted only when it is 1–64 characters of
`A-Za-z0-9_-`. Anything else — a newline, a control character, a megabyte of
text — is discarded and a fresh ID generated. That value ends up in log lines
and error bodies, so a half-sanitised identifier is worth less than an honest
new one. Generated IDs look like `req_` followed by 24 hex characters.

## Canonical codes

| Code | HTTP | Meaning |
|---|---|---|
| `RAVEN_AUTH_ERROR` | 401 | Credentials missing, malformed, or rejected. |
| `RAVEN_TOKEN_EXPIRED` | 401 | Distinct from the above: refresh, do not re-authenticate. |
| `RAVEN_OAUTH_ERROR` | 401 | An OAuth sign-in that could not complete: bad/expired state or a rejected code. Retry from the start of the flow. |
| `RAVEN_OAUTH_EMAIL_UNAVAILABLE` | 400 | The provider shared no usable email address. Fix is provider-side. |
| `RAVEN_OAUTH_EMAIL_UNVERIFIED` | 403 | The email belongs to an existing account, but the provider has not verified it — linking refused. |
| `RAVEN_PERMISSION_DENIED` | 403 | Authenticated, but not allowed to do this. |
| `RAVEN_NOT_FOUND` | 404 | Generic; used when no resource-specific code fits. |
| `RAVEN_PROJECT_NOT_FOUND` | 404 | |
| `RAVEN_ROOM_NOT_FOUND` | 404 | An RTC room. |
| `RAVEN_CONVERSATION_NOT_FOUND` | 404 | A chat conversation. |
| `RAVEN_MESSAGE_NOT_FOUND` | 404 | |
| `RAVEN_ATTACHMENT_NOT_FOUND` | 404 | |
| `RAVEN_CONFLICT` | 409 | Generic conflict — a name already taken, a state already reached. |
| `RAVEN_MESSAGE_ALREADY_EXISTS` | 409 | An idempotency key was replayed. |
| `RAVEN_CONVERSATION_ARCHIVED` | 409 | Unarchive it first. |
| `RAVEN_VALIDATION_FAILED` | 400 | The request body or query is malformed. |
| `RAVEN_INVALID_CURSOR` | 400 | Pagination cursor unreadable — do not fall back to page one. |
| `RAVEN_PAYLOAD_TOO_LARGE` | 413 | Generic size limit. |
| `RAVEN_MESSAGE_TOO_LARGE` | 413 | The message body limit specifically. |
| `RAVEN_ATTACHMENT_TOO_LARGE` | 413 | The attachment limit, configured separately from the above. |
| `RAVEN_RATE_LIMITED` | 429 | Carries `retryAfterSeconds`. |
| `RAVEN_CONNECTION_FAILED` | — | A realtime connection could not be established. |
| `RAVEN_WEBHOOK_FAILED` | — | A webhook delivery failed. |
| `RAVEN_NOT_CONFIGURED` | 501 | The deployment has not enabled this feature. An operator fix, not a caller one. |
| `RAVEN_INTERNAL_ERROR` | 500 | The only code an unexpected exception ever surfaces as. |

Codes are grouped so that anything a caller would handle the same way shares
one code, and anything needing a different fix gets its own. `RAVEN_MESSAGE_TOO_LARGE`
and `RAVEN_ATTACHMENT_TOO_LARGE` are separate because the two limits are
configured independently — "make it smaller" is not actionable until you know
which limit you crossed.

### SDK-side codes

The server SDKs use the same namespace for failures that never reach the API,
so one `switch` covers everything:

`RAVEN_TIMEOUT`, `RAVEN_NETWORK_ERROR`, `RAVEN_INVALID_CONFIG`,
`RAVEN_UNKNOWN_ERROR`.

When a proxy returns an HTML error page instead of JSON, the SDK derives the
code from the status — and derives it to the *same* name the API would have
sent, so a 401 is `RAVEN_AUTH_ERROR` either way.

## `legacyCode` and the migration

Before this namespace existed, `code` held bare values: `NOT_FOUND`,
`UNAUTHORIZED`, `VALIDATION_FAILED`, and the chat codes such as
`INVALID_CURSOR`. Anything switching on those keeps working: every error body
now carries **both**, with `legacyCode` holding exactly what that error used
to emit.

```js
// Old — still works, for now
if (error.code === 'NOT_FOUND') { ... }        // now error.legacyCode

// New
if (error.code === 'RAVEN_ROOM_NOT_FOUND') { ... }
```

`legacyCode` is deprecated and will be removed. Nothing in this repository
reads it; it exists purely for callers we cannot see. Migrate by switching on
`code` and deleting any reference to `legacyCode`.

Note that `legacyCode` is lossy in one direction: several canonical codes map
back to the same legacy value (`RAVEN_ROOM_NOT_FOUND` and
`RAVEN_MESSAGE_NOT_FOUND` were both `NOT_FOUND`). That is the point — the new
codes carry information the old ones did not.

---

## RTC errors

Every RTC error a developer sees — in the dashboard, in `raven errors`,
or in an `@ravenkash/rtc` `error` event — is a **Raven concept**, never a raw
SFU or coturn error code. `apps/api/src/modules/observability/error-classifier.ts`
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
| `SFU_ERROR` | The media server couldn't complete the connection, for no more specific reason. |
| `NETWORK_ERROR` | A generic network-level failure or timeout. |
| `CLIENT_ERROR` | A local/application-side issue — wrong room, device permission, media error. |
| `UNKNOWN_ERROR` | Nothing more specific could be determined. |

## SDK error code → category mapping

| `@ravenkash/rtc` `RTCErrorCode` | Category |
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

> These are the codes on the **WebSocket `error` frame**. Over HTTP the same
> failures arrive as `RAVEN_*` codes (with the chat code preserved in
> `legacyCode`) — see the envelope section above. The frame keeps its own
> vocabulary because it is a separately versioned wire protocol that
> `@ravenkash/chat` already maps.

Every failure from the chat API or `@ravenkash/chat` carries one of these codes.
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
- `@ravenkash/chat`'s `error` event and rejected promises
- `docs/chat/websocket.md` for the frame-level contract
