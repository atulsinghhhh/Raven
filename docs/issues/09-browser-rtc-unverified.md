# 09 — Browser RTC call has never been verified end to end

**Severity:** Low · **Area:** Testing

## What is wrong

Everything **up to** media has been verified in production: RTC token
minting, the `wss://` signaling endpoint, `iceServers` carrying
`stun:`/`turn:`/`turns:` on `turn.ravenstack.online`, TURN credentials
accepted by coturn with a public relay address, forged credentials
rejected, the SFU registered and healthy, and UDP 51000 reachable from the
internet.

**No actual peer connection has been established.** Two real browsers with
camera access are required and were outside what the deployment tooling
could drive. So the claim "RTC works" is not yet earned.

## Specifically unverified

- ICE reaches `connected` against the Azure SFU.
- Media flows both ways (SRTP on the 51000–51200 range).
- The SFU's node link comes up. Note `/readyz` on the SFU reports
  `nodeLinks: 0` and `ready: false` at idle, because the link is
  established when the control plane needs it. Whether it establishes on a
  real room allocation is untested in production.
- Relay actually carries media when a direct path is unavailable — the
  Allocate succeeds, but no relayed stream has been pushed through it.
- Simulcast, track subscription changes, renegotiation.

## How to verify

`examples/media-demo/` is the existing harness — real camera and microphone
through `@corvidhq/rtc`. It must be served over HTTP, not `file://`, since
browsers block camera access on `file://`.

1. Mint a token against `https://api.ravenstack.online`
   (`infrastructure/azure/tests/api-e2e.sh` shows the full path).
2. Open the demo in two browsers, ideally on different networks.
3. In `chrome://webrtc-internals`, confirm the selected candidate pair
   reaches `succeeded`, and check the pair type.
4. Force relay to exercise TURN: block UDP, or use the
   `test/forced-turn-relay` branch which exists for this.
5. Confirm the SFU advertises the **public** IP in its candidates. A
   `10.10.1.x` candidate means `SFU_PUBLIC_IP` is wrong and every call is
   silently relaying — the single most expensive misconfiguration
   available (see `docs/rtc/networking.md`).

## Note

`scripts/rtc-load-test.sh` exists for load, but a headless load test does
not substitute for one real browser call — it exercises different code paths
than a live camera track.
