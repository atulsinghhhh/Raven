# DTLS role probe: what Chrome sees during a Raven join + publish

Companion to [`dtls-role-probe.js`](./dtls-role-probe.js), which records
every SDP the browser applies and the DTLS role each side ends up with.
This file is the captured evidence for the SFU always taking the DTLS
server role ([`services/sfu/internal/room/manager.go`](../../services/sfu/internal/room/manager.go)).

Both captures below are real Chrome against a real Pion SFU
(`pion/webrtc/v4 v4.2.20`), driven by the standalone SDK harness in
[`test/`](../../test) — plain HTML plus `@ravenkash/rtc`, no React, no
Next.js, no application-level `RTCPeerConnection`.

## Why the probe looks at `a=setup`, not at whether media flows

The DTLS role belongs to the transport, and a session cannot change it once
the handshake has run. Raven negotiates in *both* directions on one
`RTCPeerConnection`:

| exchange | offerer | answerer |
| --- | --- | --- |
| join, and every subscription renegotiation | SFU | browser |
| publish (camera, mic, screen share, data channel) | browser | SFU |

So the role has to come out identical either way, and only the `a=setup`
attribute says whether it did. A pion client tolerates the flip that
libwebrtc refuses, which is why the Go suite could stay green through this
bug — see the note at the top of
[`dtls_role_test.go`](../../services/sfu/internal/room/dtls_role_test.go).

## Before: the SFU answered `active`

One participant, empty room, `SetAnsweringDTLSRole` not configured (so pion
falls back to `defaultDtlsRoleAnswer`, which is `DTLSRoleClient`):

```
sfu     offer  a=setup:actpass   applied
browser answer a=setup:active    applied   -> browser is the DTLS client, SFU the server
browser offer  a=setup:actpass   applied   (publishing camera + mic)
sfu     answer a=setup:active    REJECTED
```

```
Failed to execute 'setRemoteDescription' on 'RTCPeerConnection':
Failed to set remote answer sdp: Failed to apply the description for
m= section with mid='0': Failed to set SSL role for the transport.
```

The SFU claimed the client role it had already given away at join. Chrome
refused the answer, ICE stayed in `checking` until it failed 30s later,
`dtlsState` never left `new`, and not one RTP packet moved — while the SDK
log said `camera published`.

## After: the SFU answers `passive`

Same page, same room, `SetAnsweringDTLSRole(webrtc.DTLSRoleServer)`:

```
sfu     offer  a=setup:actpass   applied
browser answer a=setup:active    applied
browser offer  a=setup:actpass   applied   (publishing camera + mic)
sfu     answer a=setup:passive   applied   -> role unchanged: browser client, SFU server
```

Chrome's own `RTCTransportStats` agrees, on every session captured:

```
dtlsRole: "client"      dtlsState: "connected"     iceState: "connected"
srtpCipher: "SRTP_AEAD_AES_256_GCM"
```

`a=setup:passive` in an answer is the only correct value here: RFC 5763 §5
forbids `actpass` in an answer, and `active` is the role the browser already
holds.

## Running it

```bash
# terminal 1 - control plane + SFU + the static harness (see test/README.md)
pnpm --filter @ravenkash/rtc build
RAVEN_API_KEY=… RAVEN_API_URL=http://localhost:4100 pnpm --filter @raven/test-1to1 start
```

Open <http://localhost:8900>, paste `dtls-role-probe.js` into the DevTools
console **before** clicking *Join call*, then join and publish:

```js
__dtlsProbe.events         // the SDP timeline, in order
__dtlsProbe.roles()        // browser/SFU DTLS role per PeerConnection
await __dtlsProbe.stats()  // dtlsState, ICE state, selected pair, RTP counters
```

The probe is a diagnostic and stays one: it wraps `RTCPeerConnection` to
read what passes through, never rewrites SDP, and is not loaded by the SDK,
the harness, or any test.
