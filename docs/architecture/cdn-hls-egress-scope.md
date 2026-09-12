# CDN/HLS egress tier for viewers beyond the SFU cap

*Scoping document — no code written against this yet. Picks up the gap
`docs/production/live-streaming-media-capacity.md` §8 ("Future architecture")
explicitly left open: "Multi-SFU fan-out, CDN/HLS/DASH distribution,
transcoding... are explicitly out of scope."*

*Superseded in two ways by the broadcast-first redesign that followed this
doc: (1) HLS is no longer a fallback past a 50-viewer threshold — a
`deliveryMode: BROADCAST` stream is HLS-only for its entire audience from
the start, per an explicit product decision that rejected the "promote at
viewer 51" model this doc originally scoped; (2) §9's storage
recommendation (Cloudflare R2) was explicitly overridden — the product
owner chose to stay on Azure. See `docs/architecture/HLD.md` and
`infrastructure/azure/15-egress-storage.sh` onward for what was actually
built: Azure Blob Storage + Azure Front Door, with a real
`@azure/storage-blob`-based driver (`services/egress-worker/src/storage/
azure-blob-storage-driver.ts`), not the S3-compatible presigner this doc
assumed. §4/§8's Option B analysis (headless-subscriber egress worker,
zero SFU changes) is the one part of this doc that carried forward
unchanged and is what actually shipped.*

## 1. Problem

Live Streaming today has exactly one delivery path, for hosts and viewers
alike: join the stream's underlying Room, get a real WebRTC `PeerConnection`
to the SFU (`services/sfu`), get a `DownTrack` per subscribed track. A viewer
credential (`LiveStreamsService.createViewerToken`,
`apps/api/src/modules/live-streams/live-streams.service.ts:652`) is a normal
RTC token with `publish: false` — there is no second delivery mechanism, and
the SFU has no consumer type other than `DownTrack`
(`services/sfu/internal/room/downtrack.go:89`;
`PublishedTrack.AddSubscriber` at `publishedtrack.go:340` is hard-typed to
it). Cost per viewer is therefore identical to cost per call participant,
and `live-streaming-media-capacity.md` §5 already recommends capping public
streams at **50 viewers** on a single SFU node before quality degrades.

This is the same split every large-scale live platform (Agora, Millicast,
LiveKit) makes deliberately: keep small/interactive audiences on real
sub-second WebRTC, and once an audience is large enough that per-viewer SFU
cost stops being interactive-worth-it anyway, hand the rest off to
CDN-cached HLS, which is O(1) origin cost regardless of viewer count. This
doc scopes that hand-off for this codebase specifically — not a generic
HLS tutorial.

## 2. Goals / non-goals

**In scope:**
- Viewers joining after a stream's live SFU-connected viewer count crosses
  a threshold (50, matching the existing recommendation) get HLS instead of
  a WebRTC join.
- One-way promotion per stream: once a stream is on HLS, it stays on HLS
  until it ends. No demotion back to WebRTC-only if viewer count drops —
  not worth the added state machine for v1.
- Existing WebRTC path for hosts and the first 50 viewers is completely
  unchanged.

**Out of scope for this pass:**
- Low-latency HLS (LL-HLS/CMAF chunked transfer). Standard 6-second-segment
  HLS first; LL-HLS is a follow-on if the multi-second delay proves
  unacceptable for a real customer.
- Per-viewer analytics/QoE on the HLS side.
- Cascading/mesh SFU (spreading one room's *live* fan-out across multiple
  SFU nodes) — a materially different project from CDN egress and doesn't
  share components with it.
- Recording/VOD (this doc is about *live* distribution only, though the
  same egress pipeline is the natural place to add it later).

## 3. Why this can't be a small SFU change

`PublishedTrack`'s only subscriber path is `AddSubscriber(down *DownTrack)`
/ `RemoveSubscriber` (`publishedtrack.go:340,379`), and the only thing that
ever constructs a `DownTrack` is `Participant.Subscribe`
(`participant.go:280,321`), which always builds a live WebRTC transport.
There is no interface abstraction a second consumer type (a recorder, an
egress tap) could implement today — grepping `services/sfu` and `docs/` for
`record`, `egress`, `tap`, `hls`, `transcode` turns up nothing but this gap
being named, never scaffolded.

Two ways to get media out of the SFU for transcoding:

**Option A — native SFU egress tap.** Add a second subscriber type inside
`services/sfu` that receives RTP directly (no ICE/DTLS/PeerConnection
overhead) and hands it to a transcoder. Cheapest at runtime — no duplicate
WebRTC transport — but touches the SFU's core Go media path, which is the
highest-blast-radius, hardest-to-safely-change part of this whole system,
and has no existing test scaffolding for a second consumer type.

**Option B — headless-subscriber egress worker.** A small standalone
service joins the stream's room exactly like any other viewer — same
`createViewerToken` path, same `@ravenkash/rtc` client SDK, `publish:
false` — and is simply never counted against the public viewer cap because
it's an internal, not-a-real-viewer participant (same distinction the
existing `ChatActor.internal` flag draws for the system chat message in
`LiveStreamsService.create()` — see `LIVE_STREAM_P0_FIX_REPORT.md` §5). It
receives the host's real WebRTC tracks over a normal `PeerConnection`,
pipes them to `ffmpeg`/GStreamer, which segments to HLS and pushes segments
to object storage behind a CDN.

**Recommendation: Option B for v1.** Zero changes to `services/sfu` — the
riskiest component to touch — and 100% reuse of the existing,
already-verified join path (§9 of the P0 report proved real host→viewer
media over exactly this path). The cost is one extra full subscriber
connection per promoted stream (negligible — one connection regardless of
how many HLS viewers are behind it, versus 50+ that would otherwise exist)
and slightly higher latency than a native tap (an extra decode/encode
hop). Option A is a legitimate future optimization once egress volume
justifies touching the SFU core, not a v1 requirement.

## 4. New components

```text
Host (WebRTC, unchanged)
   |
   v
services/sfu  (unchanged — sees one more ordinary subscriber)
   |
   +--> up to 50 real viewers, live WebRTC (unchanged)
   |
   +--> [NEW] egress-worker  (headless @ravenkash/rtc subscriber, publish:false)
             |
             v
         ffmpeg/GStreamer: decode -> re-encode -> HLS segmenter
             |
             v
         [NEW] object storage  (segments + manifest)
             |
             v
         [NEW] CDN  (caches segments/manifest at edge)
             |
             v
         viewer #51+  (any HLS-capable player, hls.js in the browser SDK)
```

**a. Trigger.** Viewer count is pull-only today —
`SfuRoomStateService`/`toView()` compute it live per request
(`live-streams.service.ts:889-911`, `sfu-room-state.service.ts:60-61`,
`LiveParticipantInfo.viewerCount: number | null`) rather than being pushed
or stored. A promotion trigger needs a new poll loop (while a stream is
`LIVE`, check its live viewer count every few seconds) — no new
instrumentation to *read* the count, but a new place that polls it
proactively instead of only on request.

**b. Egress-worker service.** New standalone process (own container/VM,
not inside `apps/api` or `services/sfu`). Given one already exists per
promoted stream and `raven-sfu` is VM-deployed rather than Container-Apps
(`infrastructure/azure/06-deploy-sfu.sh`), the natural home is either
another VM role or a small Container App — a deploy decision, not an
architecture one.

**c. Object storage + CDN — the actual infrastructure gap.** Confirmed
nothing exists today: no `az cdn`/Front Door, no Azure Media Services, no
`az storage account create` anywhere in `infrastructure/azure/`. Worse,
`apps/api`'s only storage driver is a hand-rolled S3 SigV4 presigner
(`apps/api/src/modules/chat/attachments/s3-presign.util.ts`) already known
broken against Azure Blob's SharedKey/SAS auth
(`docs/issues/06-azure-blob-storage-driver.md`), and `STORAGE_BUCKET` is
unset in production — attachments are disabled today for the same
unresolved reason. Recommend closing that gap with a genuinely
S3-compatible object store (Cloudflare R2 or Backblaze B2, both named in
issue 06) rather than Azure Blob, which would let the existing presigner
work as originally written and gives free/cheap egress at a CDN edge in
the same move (R2 pairs with Cloudflare's CDN directly; B2 pairs with
Cloudflare's free bandwidth alliance). This is a shared fix, not a
duplicate one — issue 06 and this doc's storage need are the same
underlying gap.

**d. API surface.** `LiveStreamView` needs an optional `hlsUrl` once a
stream has been promoted (analogous to how `viewerCount: number | null`
already distinguishes "not known yet" from "genuinely zero"). The existing
webhook pipeline is built for exactly this kind of extension — its own
module comment says later phases "publish through the same machinery
instead of inventing a second one"
(`apps/api/src/modules/webhooks/webhook-events.service.ts:6-9`) — so this
is one new entry in `WEBHOOK_EVENT_TYPES`
(`webhook-events.service.ts:12-26`, alongside the existing
`live_stream.*` events) plus one `emit()` call at the point the poll
trigger fires, not a new notification mechanism.

**e. SDK/client.** `@ravenkash/rtc`'s viewer join path needs a fallback:
if `viewer-tokens` (or the stream's current state) indicates HLS mode,
render an `<hls.js>`-backed `<video>` element instead of opening a
`PeerConnection`. This is the only user-facing behavior change for a
viewer — from their side it should look like "the stream took a bit longer
to start" via a buffering state, not an error.

## 5. Phasing

1. **Storage/CDN foundation** — provision the S3-compatible store + CDN
   (also fixes issue 06's chat-attachments gap as a side effect), no
   live-stream-specific code yet.
2. **Egress worker** — headless subscriber + ffmpeg HLS segmentation +
   upload, manually triggered (a CLI flag/admin endpoint), proven against
   one real stream end-to-end before any automatic trigger exists.
3. **Automatic promotion** — the viewer-count poll loop, the webhook event,
   `hlsUrl` on `LiveStreamView`.
4. **SDK fallback** — `@ravenkash/rtc`/`@ravenkash/react` viewer path
   switches to `hls.js` when the stream reports HLS mode.

Each phase is independently testable and shippable; nothing later depends
on guessing right on an earlier phase's internals, only its external
contract (a manifest URL exists; an event fires; a component renders a
fallback).

## 6. Open product decisions

- Exact promotion threshold: this doc assumes 50 (matching the existing
  public-stream recommendation) but that number was chosen for WebRTC
  quality degradation, not for what makes sense as an HLS cutover point —
  worth an explicit product call rather than inheriting it silently.
- HLS segment duration (latency vs. cache-efficiency trade-off) — 6s is a
  reasonable default, not asserted as correct here.
- Whether a promoted stream should ever demote back to WebRTC-only (this
  doc recommends no, for v1 simplicity) if viewer count later drops back
  under the threshold.
- Cost ownership: an egress worker + transcode is real, ongoing infra cost
  per promoted stream regardless of how many HLS viewers actually show up
  — worth a usage-allowance/billing conversation before this ships, not
  after.
