# Livqeno RTC — Security

Three credentials, three blast radiuses, three separate keys. Plus what
the media plane refuses to trust even from Livqeno's own control plane.

---

## Secrets

| Variable | Signs | Held by | If it leaks |
|---|---|---|---|
| `JWT_SECRET` | Dashboard session JWTs | The API | An attacker can act as any developer in the dashboard. |
| `CHAT_TOKEN_SECRET` | Chat tokens | The API | An attacker can read and write messages as any user. |
| `RTC_TOKEN_SECRET` | RTC tokens | The API | An attacker can join any room as anyone. |
| `SFU_REGISTRATION_SECRET` | Nothing — a bearer credential | The API and every SFU | An attacker can register a rogue RTC server and be handed rooms to serve. |

**All four must be distinct.** Production boot fails otherwise:

```text
RTC_TOKEN_SECRET must differ from JWT_SECRET — they authorize different things
RTC_TOKEN_SECRET must differ from CHAT_TOKEN_SECRET — a leaked chat key must not mint media credentials
SFU_REGISTRATION_SECRET must differ from RTC_TOKEN_SECRET — a leaked client token key must not let an attacker join the SFU fleet
```

Refusing to start is deliberate. A deployment where one leaked credential
mints all of them is worse than a deployment that will not boot, because
the first failure is silent and the second is not.

```bash
openssl rand -hex 32   # each, independently
```

Locally, `RTC_TOKEN_SECRET` and `SFU_REGISTRATION_SECRET` fall back to
`JWT_SECRET` so a fresh clone boots. Production validation rejects that
fallback.

---

## RTC tokens

Livqeno's own HS256 JWT. Readable by whoever holds it — the same information
the server will act on — and not modifiable by them.

```json
{
  "jti": "2b45e0e5-…",           // also the rtc_tokens row id: revocable, traceable
  "sub": "alice",                 // participant identity your backend chose
  "pid": "project_123",
  "env": "PRODUCTION",
  "rid": "room_123",              // room id
  "rnm": "support-room",          // room name, for humans
  "perms": {
    "join": true, "subscribe": true, "publish": true,
    "publishAudio": true, "publishVideo": true, "publishData": false
  },
  "iat": 1786980269,
  "exp": 1786980869,              // always short
  "aud": "raven-rtc",             // a chat token can never be replayed as this
  "iss": "raven"
}
```

### Rules the verifier follows

**The signature is checked before any claim is read.** No unverified,
attacker-controlled value ever reaches a decision.

**`aud` and `iss` are fixed.** A dashboard session JWT or a chat token
cannot be used as an RTC token even if a secret were shared by accident.
Each is signed with its own key *and* carries its own audience — two locks,
not one.

**Structural incompleteness is rejected outright.** A token with no
`perms` is not treated as a token granting nothing; it is treated as not a
token. The difference between those two is the difference between a
confusing bug report and a silent authorization hole in whichever
direction the defaults happen to fall.

**`TOKEN_EXPIRED` is distinguished from `INVALID_TOKEN`** — but only after
the signature proves the expiry claim is ours to trust. A client whose
token merely aged out should be told to refresh, not left guessing.

**Nothing is echoed back.** Error messages never reflect the input, never
carry a stack trace, and never carry a native error string.

### Never mint in a browser

```ts
// Your backend, with your own rules about who may join what.
const token = await raven.tokens.create({ room: 'room_123', identity: user.id });

// Your frontend, given the whole mint response.
const client = createRTCClient({ token, endpoint, iceServers });
```

Minting requires a Livqeno API key. An API key in a browser is a Livqeno API
key belonging to whoever opens the developer tools.

### Expiry and refresh

Every token expires; there is no way to request one that does not. The
default is 10 minutes, the maximum 6 hours.

For calls longer than a token's life, give the SDK a refresher:

```ts
const client = createRTCClient({
  token,
  endpoint,
  iceServers,
  refreshToken: async () => (await fetch('/api/raven-token').then((r) => r.json())).token,
});
```

The SDK refreshes before reconnecting rather than after being rejected —
a reconnect following a long outage very often has an expired token, and
discovering that by being rejected costs an extra round trip and a
confusing log line.

---

## Permissions

Six booleans, resolved once at mint time and signed.

| Permission | Grants |
|---|---|
| `join` | Entering the room at all. |
| `subscribe` | Receiving other participants' tracks. |
| `publish` | Sending any track. |
| `publishAudio` | Restricts publishing to audio — only meaningful with `publish`. |
| `publishVideo` | Restricts publishing to video — only meaningful with `publish`. |
| `publishData` | Using the data channel. |

Two behaviours worth knowing:

**Anything unset is denied.** There is no permissive default to inherit.

**`publish: true` with neither sub-flag means both are allowed.** "Let
this participant publish, I don't care what" is the common case, and the
sub-flags exist to *narrow* it. That widening happens at mint time, where
it can be reasoned about, rather than being re-derived by every verifier.

A sub-flag without `publish` grants nothing — the sub-flags were never
independently sufficient.

### Enforced twice, on purpose

The control plane checks a permission before relaying anything to the
media plane. **The SFU checks again.**

That is not redundancy for its own sake. It is four boolean checks on
paths that already exist, and the alternative is that a bug in signaling
becomes a media-plane authorization hole. A client that negotiates a track
it was not granted has it dropped by the node, not forwarded.

The node link is authenticated and internal, and the node still does not
trust what arrives on it. That is the point.

---

## What is never trusted from a client

| The client says | Livqeno uses |
|---|---|
| `roomId` in `room.join` | The `rid` claim. A mismatch is rejected, not preferred. |
| Its identity | The `sub` claim. |
| Its permissions | The `perms` claim. |
| Its project or environment | The `pid` / `env` claims. |
| Which SFU to use | The allocator's decision. A client is never told an address. |
| A track's source | This one *is* client-declared — see below. |

A track's source (`camera` / `microphone` / `screenShare`) is the one
piece of client-supplied metadata Livqeno accepts, because WebRTC provides
no way to derive it and a page cannot control the ids that reach the SDP.
It is metadata, not authorization: a client that mislabels its camera as a
screen share has lied about a label in other people's UI, and gained no
access it did not already have. Publishing at all still requires
`publish`, and the *kind* is checked against `publishAudio` /
`publishVideo` from the signed token.

---

## Transport

| Link | Requirement |
|---|---|
| Client → API (HTTPS) | TLS. Enforced by your ingress. |
| Client → signaling (WebSocket) | **`wss://` in production** — validated at boot. The token travels as a query parameter. |
| Client ↔ SFU (media) | DTLS-SRTP. Not optional in WebRTC; there is no unencrypted mode. |
| API ↔ SFU (node link) | Bearer-authenticated. Internal network only — never publicly reachable. |
| Client → TURN | `turns:` on 5349 available and required in production. |

The token in a query parameter is a deliberate trade: a browser's
WebSocket API cannot set request headers, and the alternatives (a
post-connect auth frame, a cookie) each cost either a round trip or
cross-site exposure. It is mitigated by making the token short-lived and
the connection TLS-only.

---

## TURN credentials

Ephemeral, minted per token, sharing its lifetime:

```json
{
  "urls": "turn:turn.example.com:3478?transport=udp",
  "username": "1786980869:alice",
  "credential": "<hmac-sha1(TURN_SECRET, username), base64>"
}
```

`TURN_SECRET` never leaves the server. A client holds a credential that
expires with its token, so a leaked one cannot be used to relay traffic
indefinitely.

---

## Rate limiting and abuse

| Surface | Limit | Backed by |
|---|---|---|
| Token minting | 60 / window / IP | Redis |
| Signaling upgrades | `SIGNALING_MAX_CONNECTIONS_PER_WINDOW` / IP | Redis |
| Signaling messages | `SIGNALING_MAX_MESSAGES_PER_WINDOW` / connection | In-memory sliding window |
| Message size | `SIGNALING_MAX_MESSAGE_BYTES` (16 KiB) | Rejected before parsing |
| Data channel payload | 64 KiB | SDK, before send |
| Room size | `SIGNALING_MAX_PARTICIPANTS_PER_ROOM`, and the node's own capacity | Both |

A reconnecting participant replaces its own stale session rather than
adding a second, so a client in a reconnect loop cannot fill a room with
ghosts of itself.

---

## Reporting a vulnerability

See the repository's security policy. Please do not open a public issue
for anything exploitable.

---

## See also

- [Architecture](./architecture.md) — where authorization sits in the flow
- [Signaling](./signaling.md) — the error taxonomy
- [SFU](./sfu.md) — the node link and its credential
