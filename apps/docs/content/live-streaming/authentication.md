---
title: Live Streaming Authentication
description: Host and viewer credentials are minted separately, and a viewer's RTC token cannot publish — not by policy, by construction.
---

A live stream issues two kinds of credential, each bundling an RTC
token and a chat token together:

```bash
# Host/co-host — full publish permission, chat ADMIN/MODERATOR scope
curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/hosts \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"identity": "alice", "role": "HOST"}'

# Viewer — subscribe-only, chat MEMBER scope
curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/viewer-tokens \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"identity": "carol"}'
```

## Viewers cannot become hosts client-side

The viewer-token request has no `role` field at all — there is nothing
to set to escalate it. The RTC token it returns always has
`publish: false`, `publishAudio: false`, `publishVideo: false`,
`publishData: false` baked in server-side, and the chat token always
carries `MEMBER` scope. Passing an unrecognized field like `role` in
the request body is rejected outright, not silently ignored.

## Host vs. co-host

Both get full publish permission and moderate chat (`ADMIN` for `HOST`,
`MODERATOR` for `CO_HOST`) — the distinction is who can invite/remove
other hosts, not what either can publish. See
[Hosts & Co-hosts](/live-streaming/hosts).

## Under the hood

These are ordinary [RTC](/rtc/authentication) and
[Chat](/chat/authentication) tokens — Live Streaming doesn't introduce
a third credential type. `LiveStream.join()` in the Web SDK just takes
whichever of the two your role's mint call returned.

## Next

- [Quickstart](/live-streaming/quickstart)
- [Viewers](/live-streaming/viewers)
