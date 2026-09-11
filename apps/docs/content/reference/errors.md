---
title: Errors
description: Five error vocabularies, why they are separate, and every code in each with its cause and fix.
---

Livqeno has **five** error vocabularies. They are separate on purpose: a chat
failure, a media failure and a shader failure have almost nothing in
common, and merging them would produce a list that describes none of them
well.

| Vocabulary | Where you see it | Count |
|---|---|---|
| [`RAVEN_*`](#http-error-codes) | The `code` field of any HTTP error body | 34 |
| [`RTCErrorCode`](#rtc-sdk-errors) | `@ravenkash/rtc` throws and `error` events | 13 |
| [`ChatErrorCode`](#chat-errors) | The chat WebSocket `error` frame and `@ravenkash/chat` | 26 |
| [`SignalingErrorCode`](#signaling-errors) | The RTC signaling WebSocket `error` frame | 15 |
| [`EffectsErrorCode`](#effects-errors) | `@ravenkash/effects` | 5 |

Plus [RTC error *categories*](#rtc-error-categories), which are a
server-side classification of a failure that already happened — not a
response code.

## The HTTP error envelope

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
| `legacyCode` | **Deprecated.** What that error used to emit before the namespace existed. Nothing in Livqeno reads it. |
| `message` | Human-readable, safe to log, never contains credentials or internals. |
| `requestId` | Also returned as the `x-request-id` header, always the same value. Quote it in a bug report. |
| `path` | The route that produced the error. |

Some errors add fields — a 429 carries `retryAfterSeconds`. Ignore fields
you do not recognise rather than treating them as an error.

## HTTP error codes

### Authentication and authorization

| Code | HTTP | Cause | Fix |
|---|---|---|---|
| `RAVEN_AUTH_ERROR` | 401 | Credential missing, malformed, or rejected | Check the `Authorization` header and that the key was not revoked |
| `RAVEN_TOKEN_EXPIRED` | 401 | The token expired | Mint a fresh one. Do **not** re-authenticate the user |
| `RAVEN_PERMISSION_DENIED` | 403 | Authenticated, but not allowed | Check the token's permissions, or the caller's project role |
| `RAVEN_OAUTH_ERROR` | 401 | OAuth sign-in could not complete — bad or expired `state`, failed code exchange, or the person cancelled | Always safe to retry from the start of the flow |
| `RAVEN_OAUTH_EMAIL_UNAVAILABLE` | 400 | The provider returned no usable email, and Livqeno accounts are keyed by email | Fix is at the provider — e.g. GitHub with no verified primary address |
| `RAVEN_OAUTH_EMAIL_UNVERIFIED` | 403 | An account exists for this email but the provider has not verified it | Verify at the provider. Linking otherwise would allow account takeover |

### Not found

| Code | HTTP | Cause |
|---|---|---|
| `RAVEN_NOT_FOUND` | 404 | Generic — no resource-specific code fits |
| `RAVEN_PROJECT_NOT_FOUND` | 404 | No such project, or not yours |
| `RAVEN_ROOM_NOT_FOUND` | 404 | An RTC room |
| `RAVEN_CONVERSATION_NOT_FOUND` | 404 | A chat conversation |
| `RAVEN_MESSAGE_NOT_FOUND` | 404 | No such message in this project |
| `RAVEN_ATTACHMENT_NOT_FOUND` | 404 | No such attachment, or not yet uploaded |
| `RAVEN_STREAM_NOT_FOUND` | 404 | A live stream |
| `RAVEN_RTC_SERVER_NOT_FOUND` | 404 | No media server by that name in the fleet |

Most 404s here are environment mismatches: a development key cannot see a
production room, and the room genuinely does not exist as far as that key
is concerned.

### Conflict

| Code | HTTP | Cause | Fix |
|---|---|---|---|
| `RAVEN_CONFLICT` | 409 | Generic — a name taken, a state already reached | |
| `RAVEN_MESSAGE_ALREADY_EXISTS` | 409 | A `clientMessageId` was replayed | Nothing — this is idempotency working. Treat it as success |
| `RAVEN_CONVERSATION_ARCHIVED` | 409 | Writes are closed; reads still work | Unarchive it first |
| `RAVEN_STREAM_INVALID_STATE` | 409 | Invalid from the stream's current status — starting an already-`LIVE` stream, anything on an `ENDED` one | Read the status first. `ENDED` is terminal |

### Request problems

| Code | HTTP | Cause | Fix |
|---|---|---|---|
| `RAVEN_VALIDATION_FAILED` | 400 | Body or query malformed — **including an unknown field**, which is rejected rather than ignored | Check spelling against the [parameter tables](/api/all-endpoints) |
| `RAVEN_INVALID_CURSOR` | 400 | Pagination cursor unreadable | Restart the page sequence. Do **not** silently fall back to page one |
| `RAVEN_PAYLOAD_TOO_LARGE` | 413 | Generic size limit | |
| `RAVEN_MESSAGE_TOO_LARGE` | 413 | Message text or metadata over its limit | 4000 chars / 4096 bytes by default |
| `RAVEN_ATTACHMENT_TOO_LARGE` | 413 | Over `STORAGE_MAX_ATTACHMENT_BYTES` | 25 MB by default |
| `RAVEN_RATE_LIMITED` | 429 | A budget was exceeded. Carries `retryAfterSeconds` | Back off by that value, not a fixed interval |

`MESSAGE_TOO_LARGE` and `ATTACHMENT_TOO_LARGE` are separate because the two
limits are configured independently — "make it smaller" is not actionable
until you know which limit you crossed.

### Usage limits

| Code | HTTP | Cause | Fix |
|---|---|---|---|
| `RAVEN_USAGE_LIMIT_EXCEEDED` | 403 | One of the three independent free-tier allowances (RTC minutes, Chat messages, Live Streaming host-hours) is spent | Terminal — nothing frees it up over time. See [Usage](/concepts/usage) |
| `RAVEN_STREAM_CONCURRENCY_LIMIT_EXCEEDED` | 403 | This account already has a `LIVE` stream — the free tier allows one at a time, account-wide | Not terminal — end the other stream, or wait for it to end |
| `RAVEN_STREAM_VIEWER_LIMIT_EXCEEDED` | 403 | This stream already has the free tier's maximum viewers | Not terminal — retry once a viewer leaves |

The last two are deliberately not `USAGE_LIMIT_EXCEEDED`: a concurrency or
viewer cap means "not right now, not another one," never "you're out and
need more allocated" — conflating them would make a caller unable to tell
"wait" apart from "nothing left to give."

### Infrastructure

| Code | HTTP | Cause | Fix |
|---|---|---|---|
| `RAVEN_CONNECTION_FAILED` | — | A realtime connection could not be established | See [RTC troubleshooting](/rtc/troubleshooting) |
| `RAVEN_NO_RTC_CAPACITY` | — | No healthy media server had room | An operator problem, not a caller one. Check the fleet |
| `RAVEN_WEBHOOK_FAILED` | — | A webhook delivery failed | Check the deliveries endpoint |
| `RAVEN_NOT_CONFIGURED` | 501 | The deployment has not enabled this feature — most often attachments with no `STORAGE_BUCKET` | An operator fix |
| `RAVEN_INTERNAL_ERROR` | 500 | The only code an unexpected exception surfaces as | Quote the `requestId` |

### Server-SDK-local codes

Raised by `@ravenkash/server` and `raven-sdk` before a request leaves the
process, so they never appear in an HTTP body — but they share the
namespace so one `switch` covers everything:

| Code | Cause |
|---|---|
| `RAVEN_INVALID_CONFIG` | No config object, or a missing `apiKey` |
| `RAVEN_TIMEOUT` | The request exceeded the client timeout (10s default) |
| `RAVEN_NETWORK_ERROR` | The request never reached Livqeno |
| `RAVEN_UNKNOWN_ERROR` | Nothing more specific could be determined |

When a proxy returns an HTML error page instead of JSON, the SDK derives
the code from the status — and derives it to the *same* name the API would
have sent, so a 401 is `RAVEN_AUTH_ERROR` either way.

### `legacyCode` and the migration

Before this namespace existed, `code` held bare values: `NOT_FOUND`,
`UNAUTHORIZED`, `VALIDATION_FAILED`. Every error body now carries **both**.

```js
if (error.code === 'NOT_FOUND') { … }        // old — now error.legacyCode
if (error.code === 'RAVEN_ROOM_NOT_FOUND') { … }   // new
```

`legacyCode` is lossy in one direction — several canonical codes map back
to the same legacy value. That is the point: the new codes carry
information the old ones did not. It is deprecated and will be removed.

## RTC SDK errors

`RTCError` is the only error type `@ravenkash/rtc` throws or emits. Never a
raw browser `DOMException`.

| Code | Cause | Fix |
|---|---|---|
| `INVALID_TOKEN` | Malformed, or missing `token`/`endpoint` in the config | Forward the mint response untouched |
| `TOKEN_EXPIRED` | Already expired when the client was created | Mint on demand, not at page load |
| `ROOM_NOT_FOUND` | `join()` was given a room the token was not minted for | Pass the room id or name from the mint response |
| `PERMISSION_DENIED` | The token does not grant this | Fix the permissions at mint time |
| `CAMERA_PERMISSION_DENIED` | The **user** denied camera access | Prompt in your own UI; the OS will not ask twice |
| `MICROPHONE_PERMISSION_DENIED` | The user denied microphone access | As above |
| `DEVICE_NOT_FOUND` | No such device, or it was unplugged | Re-enumerate with `getDevices()` |
| `NETWORK_ERROR` | A network-level failure | |
| `SIGNALING_ERROR` | The signaling handshake did not complete | Check `endpoint` is reachable and `wss://` |
| `MEDIA_ERROR` | A media operation failed — **worth retrying** | |
| `NOT_SUPPORTED` | The platform cannot do this at all, e.g. screen share with no `getDisplayMedia` | **Permanent.** Hide the button rather than retrying |
| `CONNECTION_FAILED` | ICE/DTLS did not complete | Usually TURN. See [troubleshooting](/rtc/troubleshooting) |
| `TIMEOUT` | An operation exceeded its deadline | |

`NOT_SUPPORTED` and `MEDIA_ERROR` are deliberately distinct: one is a
permanent fact about the device that a UI should act on, the other is a
failure worth retrying.

```ts
import { isRTCError } from '@ravenkash/rtc';

room.on('error', (error) => {
  if (!isRTCError(error)) return;
  if (error.code === 'CAMERA_PERMISSION_DENIED') showPermissionHelp();
  if (error.code === 'NOT_SUPPORTED') hideFeature();
});
```

## RTC error categories

A **classification** applied server-side to a failure a client reported.
You see these in the dashboard, in `raven errors list`, and on the
observability API — never as a response code.

| Category | Meaning |
|---|---|
| `AUTHENTICATION_ERROR` | The caller's own credential was rejected |
| `AUTHORIZATION_ERROR` | Authenticated, but not allowed |
| `TOKEN_ERROR` | The RTC token was invalid, malformed, or expired |
| `SIGNALING_ERROR` | The signaling handshake did not complete |
| `ICE_ERROR` | ICE connectivity checks failed — usually a firewall or NAT |
| `TURN_ERROR` | A TURN relay connection specifically could not be established |
| `SFU_ERROR` | The media server could not complete, for no more specific reason |
| `NETWORK_ERROR` | A generic network failure or timeout |
| `CLIENT_ERROR` | A local issue — wrong room, device permission, media error |
| `UNKNOWN_ERROR` | Nothing more specific could be determined |

`CONNECTION_FAILED` is context-dependent, resolved in this order: a
`turn_unreachable` hint → `TURN_ERROR`; a failed `iceConnectionState` →
`ICE_ERROR`; signaling never reaching stable → `SIGNALING_ERROR`;
otherwise `SFU_ERROR`.

Every classified error carries a `likelyCause` and `suggestedAction`,
deliberately hedged ("likely a firewall/NAT restriction") rather than a
claim of certainty a server cannot back up.

## Chat errors

26 codes on the `@ravenkash/chat` side, 22 of which the gateway can put on
an `error` frame. They map one-to-one onto SDK error classes so you can
branch on the class rather than string-matching.

| Code | HTTP | SDK class | Meaning |
|---|---|---|---|
| `INVALID_TOKEN` | 401 | `RavenChatAuthenticationError` | Missing, malformed, or wrongly-signed |
| `TOKEN_EXPIRED` | 401 | `RavenChatAuthenticationError` | Mint a new one — wire `onTokenExpiring` |
| `TOKEN_REVOKED` | 401 | `RavenChatAuthenticationError` | Revoked before its natural expiry |
| `UNAUTHORIZED` | 401 | `RavenChatAuthenticationError` | No usable credential presented |
| `PERMISSION_DENIED` | 403 | `RavenChatPermissionError` | The scope or role does not allow this |
| `NOT_A_MEMBER` | 403 | `RavenChatPermissionError` | Not a member of that conversation. Only reported to a project API key; a chat token gets `ROOM_NOT_FOUND` so conversation names stay unenumerable |
| `ORIGIN_NOT_ALLOWED` | 403 | `RavenChatPermissionError` | The upgrade's `Origin` is not in `CORS_ORIGIN` |
| `ROOM_NOT_FOUND` | 404 | `RavenRoomError` | No such conversation in this project |
| `NOT_IN_ROOM` | 400 | `RavenRoomError` | This connection is not subscribed to that room |
| `TOO_MANY_SUBSCRIPTIONS` | 400 | `RavenRoomError` | Per-connection subscription limit reached |
| `CONVERSATION_ARCHIVED` | 409 | `RavenRoomError` | Writes closed; reads still work |
| `MESSAGE_NOT_FOUND` | 404 | `RavenMessageError` | |
| `MESSAGE_DELETED` | 409 | `RavenMessageError` | The message is soft-deleted |
| `MESSAGE_TOO_LARGE` | 413 | `RavenMessageError` | Text, metadata, or frame over its limit |
| `INVALID_MESSAGE` | 400 | `RavenMessageError` | Malformed or missing a required field |
| `INVALID_MESSAGE_TYPE` | 400 | `RavenMessageError` | Unsupported frame or message type |
| `INVALID_CURSOR` | 400 | `RavenMessageError` | Pagination cursor malformed |
| `RATE_LIMITED` | 429 | `RavenRateLimitError` | Carries `retryAfterSeconds` |
| `ATTACHMENT_NOT_FOUND` | 404 | `RavenAttachmentError` | |
| `ATTACHMENTS_NOT_CONFIGURED` | 501 | `RavenAttachmentError` | No object storage on this deployment |
| `ATTACHMENT_TOO_LARGE` | 413 | `RavenAttachmentError` | Over `STORAGE_MAX_ATTACHMENT_BYTES` |
| `CONNECTION_FAILED` | — | `RavenChatConnectionError` | Could not connect, or reconnects exhausted |
| `CONNECTION_CLOSED` | — | `RavenChatConnectionError` | The socket closed before the server replied |
| `NETWORK_ERROR` | — | `RavenChatConnectionError` | The request never reached Livqeno |
| `TIMEOUT` | — | `RavenChatConnectionError` | No response within the request timeout |
| `INTERNAL_ERROR` | 500 | `RavenChatError` | Logged server-side in full |

An unrecognised code from a newer server becomes a base `RavenChatError`
with the code preserved, rather than an exception — an older client keeps
working across a server upgrade.

Raw infrastructure failures never reach a client. A Postgres constraint
violation or a Redis timeout is logged server-side and surfaces as
`INTERNAL_ERROR`.

### Chat WebSocket close codes

| Code | Meaning | Reconnect? |
|---|---|---|
| `1000` | Normal closure | No |
| `4401` | Authentication failed | **No** — retrying cannot help |
| `4403` | Origin not allowed | **No** — fix `CORS_ORIGIN` |
| `4429` | Connection rate limit | Yes, after backing off |
| `4440` | Token expired | Yes, with a **fresh** token |
| `4500` | Server shutting down | Yes, after backing off — a deploy, not a fault |

`@ravenkash/chat` treats `4401` and `4403` as terminal and reports `failed`
rather than retrying forever.

## Signaling errors

The RTC signaling WebSocket keeps its own vocabulary — it is a separately
versioned wire protocol. You see these on an `error` frame, and the SDK
maps most of them onto an `RTCError`.

| Code | Meaning | Retryable? |
|---|---|---|
| `INVALID_TOKEN` | Malformed or wrongly-signed | No |
| `TOKEN_EXPIRED` | Expired before or during connect | Yes, with a fresh token |
| `UNAUTHORIZED` | No usable credential | No |
| `ROOM_NOT_FOUND` | No such room for this project and environment | No |
| `ROOM_FULL` | At `SIGNALING_MAX_PARTICIPANTS_PER_ROOM` | No |
| `INVALID_MESSAGE` | Malformed frame | No |
| `INVALID_MESSAGE_TYPE` | Unsupported frame type | No |
| `PARTICIPANT_NOT_FOUND` | Named participant is not in the room | No |
| `NOT_IN_ROOM` | An operation before joining | No |
| `PERMISSION_DENIED` | The token does not grant this — e.g. publishing without `publish` | No |
| `RATE_LIMITED` | Per-connection message budget exceeded | Yes, after backing off |
| `NO_RTC_CAPACITY` | No healthy media server had room | An operator problem |
| `RTC_SERVER_UNREACHABLE` | The allocated server could not be reached | **Yes** |
| `NEGOTIATION_FAILED` | Not recoverable without rejoining | No — rejoin |
| `NEGOTIATION_GLARE` | An offer is already in flight | **Yes** — answer the offer already arriving, then retry |

Full frame contract in [Signaling protocol](/rtc/signaling-protocol).

## Effects errors

| Code | Cause | Fix |
|---|---|---|
| `RAVEN_EFFECT_UNSUPPORTED` | Unknown filter type, or no usable engine on this device | Check `detectCapabilities()` |
| `RAVEN_EFFECT_INVALID_CONFIG` | Out-of-range or unknown parameter. **Never silently clamped** | See [Filters](/effects/filters) for ranges |
| `RAVEN_EFFECT_PROCESSING_FAILED` | A frame could not be processed | |
| `RAVEN_EFFECT_PERMISSION_DENIED` | An asset or operation was refused | |
| `RAVEN_EFFECT_RESOURCE_LIMIT` | Too many effects in one pipeline | |

## Next steps

- [Troubleshooting](/troubleshooting) — symptoms rather than codes.
- [Limits & quotas](/reference/limits) · [Conventions](/api/conventions)
