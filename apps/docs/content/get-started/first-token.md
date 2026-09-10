---
title: Generate a token
description: Your backend decides who a user is and what they may do, then mints a short-lived token.
---

A client never asks Raven for its own token. Your backend does, from its own
authenticated session, and hands the result to the client.

That ordering is the whole security model: a client that could name its own
identity could impersonate any other user.

## Mint one

<Tabs>
<Tab title="Node.js">

```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL!, // https://api.ravenstack.online
});

app.post('/join-room', async (req, res) => {
  const room = await raven.rooms.create({ name: 'demo-room' });

  const credentials = await raven.tokens.create({
    room: room.id,
    identity: req.user.id,
    permissions: { join: true, subscribe: true, publish: true },
    expiresIn: 600,
  });

  res.json(credentials);
});
```

</Tab>
<Tab title="Python">

```python
import os
from raven import Raven, CreateTokenParams, TokenPermissions

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ["RAVEN_API_URL"],  # https://api.ravenstack.online
)

@app.post("/join-room")
def join_room(request):
    room = raven.rooms.create(name="demo-room")

    credentials = raven.tokens.create(
        CreateTokenParams(
            room=room["id"],
            identity=request.user.id,
            permissions=TokenPermissions(join=True, subscribe=True, publish=True),
            expires_in=600,
        )
    )
    return credentials
```

</Tab>
<Tab title="curl">

```bash
curl -X POST "$RAVEN_API_URL/v1/rooms/$ROOM_ID/rtc-tokens" \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
        "participantIdentity": "user-42",
        "permissions": { "join": true, "subscribe": true, "publish": true },
        "ttlSeconds": 600
      }'
```

</Tab>
</Tabs>

## What comes back

```json
{
  "id": "2b45e0e5-97f2-466d-b783-a09fed7f6505",
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "endpoint": "wss://api.your-raven-deployment.example/v1/rtc",
  "roomId": "8d86361a-7c01-4969-98cb-d0748360b803",
  "roomName": "demo-room",
  "participantIdentity": "user-42",
  "permissions": { "join": true, "subscribe": true, "publish": true, "publishAudio": true, "publishVideo": true, "publishData": false },
  "iceServers": [{ "urls": "stun:..." }, { "urls": "turn:...", "username": "...", "credential": "..." }],
  "telemetryUrl": "https://api.your-raven-deployment.example",
  "expiresAt": "2026-09-08T21:10:00.000Z",
  "createdAt": "2026-09-08T21:00:00.000Z"
}
```

**Forward the whole object to your client.** `endpoint`, `iceServers` and
`telemetryUrl` are not decoration — they are how the SDK knows where to
connect and which relays to use. Never hand-build any of them, and never
substitute your own STUN or TURN servers: the TURN credentials in
`iceServers` are minted fresh for this token and expire with it.

## Permissions

Six flags, all denied unless granted:

| Flag | Grants |
|---|---|
| `join` | Entering the room at all |
| `subscribe` | Receiving other participants' tracks |
| `publish` | Sending any track |
| `publishAudio` | Narrows `publish` to the microphone |
| `publishVideo` | Narrows `publish` to the camera |
| `publishData` | Data-channel messages |

`publish: true` with neither sub-flag set means both are allowed —
"let them publish, I don't much care what" is the common case, and the
sub-flags exist to narrow it. A sub-flag without `publish` grants nothing.

A viewer gets `{ join: true, subscribe: true }` and **cannot** publish — not
by policy, by construction. There is no request the client can make that
widens what was signed.

## Lifetime

`expiresIn` (`ttlSeconds` over HTTP) is 30–21600 seconds. There is no way to
request a non-expiring token.

Short is the point. A token can be revoked early
(`DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}`), but that only blocks
new connections and cannot end a call already running — so the lifetime is
what actually bounds a leaked token. Mint on demand, one per participant
per join. See
[RTC authentication → Revocation](/rtc/authentication#revocation).

## Chat tokens are separate

```ts
const chat = await raven.chat.createToken({
  userId: 'alice',
  conversations: [conversation.publicId],
  scopes: ['chat:read', 'chat:send'],
  expiresIn: 3600,
});
```

Neither token works on the other plane. See
[Chat authentication](/chat/authentication).

## Next steps

- [Join your first room](/get-started/first-room) — the client side.
- [Access tokens](/authentication/tokens) — TTLs, claims, and what is checked when.
- [Permissions](/authentication/permissions) — the full grant model.
