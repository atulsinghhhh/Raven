# Signaling Protocol Reference

Wire format for `wss://<api-host>/v1/rtc?token=<RTC token>`. Every frame
is a single JSON object with a `type` field — there is no envelope, no
`event`/`data` wrapper. Source of truth for message shapes:
`apps/api/src/modules/signaling/interfaces/signaling-message.interface.ts`;
source of truth for validation rules:
`apps/api/src/modules/signaling/messages/message-validator.service.ts`.

## Connecting

```
wss://api.example.com/v1/rtc?token=<RTC token>
```

The token is the same JWT returned by
`POST /v1/rooms/:roomId/rtc-tokens` (Phase 2) — see
`docs/control-plane.md#rtc-tokens`. A connection is authenticated at the
WebSocket handshake; it must still send `room.join` to actually enter a
room (see `docs/signaling.md#room-lifecycle`).

## Client → Server messages

### `room.join`

```json
{ "type": "room.join", "roomId": "optional-must-match-token" }
```

`roomId` is optional. If present, it must equal the room bound to the
connection's RTC token, or the server responds `UNAUTHORIZED`. Requires
the `join` permission from the token, or the server responds
`PERMISSION_DENIED`. On success, the server replies `room.joined` to the
sender and `participant.joined` to everyone already in the room.

### `room.leave`

```json
{ "type": "room.leave" }
```

Requires having joined a room already (`NOT_IN_ROOM` otherwise). Server
replies `room.left` to the sender and `participant.left` to the
remaining participants.

### `sdp.offer`

```json
{ "type": "sdp.offer", "targetParticipantId": "bob", "sdp": "v=0..." }
```

Forwarded verbatim to `targetParticipantId` as `sdp.offer` with
`fromParticipantId` set to the sender. Requires having joined a room.
`targetParticipantId` must be a different participant currently in the
same room (`PARTICIPANT_NOT_FOUND` otherwise; targeting yourself is
`INVALID_MESSAGE`).

### `sdp.answer`

```json
{ "type": "sdp.answer", "targetParticipantId": "alice", "sdp": "v=0..." }
```

Same rules and routing as `sdp.offer`.

### `ice.candidate`

```json
{ "type": "ice.candidate", "targetParticipantId": "bob", "candidate": { "...": "..." } }
```

`candidate` may be any non-null JSON value (typically an object matching
`RTCIceCandidateInit`) — the server never inspects its contents, only
forwards it. Same routing/authorization rules as `sdp.offer`.

### `ping`

```json
{ "type": "ping" }
```

Server replies `pong`. Does not require having joined a room. Distinct
from the WebSocket-protocol-level ping the server itself sends for
heartbeat — see `docs/signaling.md#heartbeat`.

## Server → Client messages

### `room.joined`

```json
{ "type": "room.joined", "roomId": "room-uuid", "participants": [{ "id": "bob" }] }
```

Sent to a participant in response to their own `room.join`. `participants`
lists everyone else already in the room at that moment.

### `room.left`

```json
{ "type": "room.left", "roomId": "room-uuid" }
```

Sent to a participant in response to their own `room.leave`.

### `participant.joined`

```json
{ "type": "participant.joined", "participant": { "id": "alice" } }
```

Sent to every participant already in the room when someone new joins.
Only ever carries a public participant ID — no other participant
metadata is exposed at this phase.

### `participant.left`

```json
{ "type": "participant.left", "participant": { "id": "alice" } }
```

Sent to remaining participants when someone leaves — via explicit
`room.leave` or an abrupt disconnect. The event contract is identical in
both cases; a receiving client cannot tell (and doesn't need to) which
one occurred.

### `sdp.offer` / `sdp.answer` (relayed)

```json
{ "type": "sdp.offer", "fromParticipantId": "alice", "sdp": "v=0..." }
```

The relayed form of a peer's `sdp.offer`/`sdp.answer` — same `type`,
`fromParticipantId` instead of `targetParticipantId`.

### `ice.candidate` (relayed)

```json
{ "type": "ice.candidate", "fromParticipantId": "alice", "candidate": { "...": "..." } }
```

### `error`

```json
{ "type": "error", "code": "PERMISSION_DENIED", "message": "join permission required" }
```

`message` is a safe, human-readable string — never an internal exception
message or stack trace. `code` is always one of:

| Code | Meaning |
|---|---|
| `INVALID_TOKEN` | Token missing, malformed, wrong signature, or missing required claims |
| `TOKEN_EXPIRED` | Token signature valid but past its `exp` claim |
| `UNAUTHORIZED` | An assertion in a message (e.g. `roomId`) disagrees with the token |
| `ROOM_NOT_FOUND` | Reserved for a room-lookup failure at the control-plane level |
| `ROOM_FULL` | Room is at `SIGNALING_MAX_PARTICIPANTS_PER_ROOM` |
| `INVALID_MESSAGE` | Malformed JSON, oversized payload, or missing/invalid fields |
| `INVALID_MESSAGE_TYPE` | `type` is missing or not one of the known client message types |
| `PARTICIPANT_NOT_FOUND` | `targetParticipantId` doesn't resolve in the sender's room |
| `NOT_IN_ROOM` | Sender hasn't completed `room.join` yet |
| `PERMISSION_DENIED` | Token lacks a permission required for the attempted action |
| `RATE_LIMITED` | Connection or message rate limit exceeded |

### `pong`

```json
{ "type": "pong" }
```

## Close codes

Beyond the standard WebSocket close codes (1000 normal, 1005 no status,
etc.), this protocol uses application-reserved codes in the 4000-4999
range (RFC 6455 §7.4.2):

| Code | Meaning |
|---|---|
| `4001` | Authentication failed at connect time (see the preceding `error` frame for the specific code) |
| `4002` | This connection was replaced by a newer connection for the same participant identity |
| `4029` | Connection-level rate limit exceeded |

An `error` frame is always sent before any of these closes — a client
should not need to guess why it was disconnected.

## Versioning

This is v1 of the protocol (implicit in the `/v1/rtc` path, matching the
rest of the API's `/v1/` convention — see `docs/control-plane.md`). Any
breaking change to message shapes or error codes should ship under
`/v2/rtc` rather than silently changing this document's contract.
