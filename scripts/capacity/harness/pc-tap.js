// Captures every RTCPeerConnection the SDK constructs, before the SDK is
// loaded.
//
// `@ravenkash/rtc`'s public stats surface (`Track.getStats()`) is
// deliberately a normalized shape: bitrate, loss percent, jitter, RTT, fps.
// It does not carry `framesDecoded`, and it should not — an application has
// no use for a raw cumulative decoder counter. A capacity test does. It is
// the only stat that distinguishes "this PeerConnection is connected and a
// track is attached" from "this viewer is watching moving pictures", which
// is the whole distinction this rig exists to measure.
//
// So rather than widen the SDK's public API for a test's benefit, the
// harness taps the platform underneath it. This is a classic script, not a
// module, and it runs before the module graph is evaluated — which is the
// only ordering in which the SDK's own `new RTCPeerConnection` is seen.
(() => {
  const Native = window.RTCPeerConnection;
  const captured = [];

  function TappedRTCPeerConnection(...args) {
    const pc = new Native(...args);
    // Set by the harness immediately before each join. Joins are
    // sequential and staggered on purpose, so the tag in force when a
    // PeerConnection is constructed is unambiguously its owner's.
    pc.__ravenTag = window.__pcTag ?? null;
    pc.__ravenCreatedAt = performance.now();
    captured.push(pc);
    return pc;
  }
  TappedRTCPeerConnection.prototype = Native.prototype;
  Object.setPrototypeOf(TappedRTCPeerConnection, Native);

  window.RTCPeerConnection = TappedRTCPeerConnection;
  window.__nativeRTCPeerConnection = Native;
  window.__capturedPcs = captured;

  /**
   * Every live PeerConnection tagged for one viewer, PLUS — critically —
   * the one currently held by that viewer's `Room`, however it was
   * created.
   *
   * Tag-matching alone has a blind spot the restart scenarios walk
   * straight into: the SDK's own auto-reconnect builds a brand-new
   * `RTCPeerConnection` asynchronously, long after `joinOne()`'s
   * synchronous tagging window has closed, with `window.__pcTag` back to
   * `null` (or worse, set for a *different* viewer whose join happens to
   * be in flight at that moment). Every reconnected viewer's fresh PC
   * would then be invisible to `__pcsFor`, and a perfectly healthy
   * recovery would be reported as "no video stats" — exactly what a
   * restart test exists to measure.
   *
   * `Room.adapter` and `RavenAdapter.pc` are TypeScript `private`, which
   * is a compile-time discipline, not a runtime one: tsup's output has no
   * `#`-private fields, so both are ordinary reachable properties on the
   * built objects the harness already holds a reference to. Reading `pc`
   * here doesn't touch the SDK, doesn't rely on an undocumented export,
   * and breaks only if the field is ever renamed — the harness would
   * fail loudly (`pc.getStats is not a function`), not silently.
   */
  window.__pcsFor = (tag, room) => {
    const tagged = captured.filter((pc) => pc.__ravenTag === tag && pc.connectionState !== 'closed');
    const live = room?.adapter?.pc;
    if (live && live.connectionState !== 'closed' && !tagged.includes(live)) {
      tagged.push(live);
    }
    return tagged;
  };

  /**
   * One viewer's raw receive-side stats.
   *
   * Reads `inbound-rtp` directly rather than going through
   * `Track.getStats()`, for `framesDecoded` and for the cumulative
   * `bytesReceived` / `packetsReceived` the normalized shape drops. RTT
   * comes off the nominated candidate pair, which is the only place a
   * receive-only PeerConnection reports one at all.
   */
  window.__rawStats = async (tag, room) => {
    const pcs = window.__pcsFor(tag, room);
    const out = {
      connectionState: pcs.map((pc) => pc.connectionState),
      iceConnectionState: pcs.map((pc) => pc.iceConnectionState),
      video: null,
      audio: null,
      roundTripTimeMs: null,
      availableIncomingBitrate: null,
    };

    for (const pc of pcs) {
      let report;
      try {
        report = await pc.getStats();
      } catch {
        continue;
      }
      report.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          out.video = {
            framesDecoded: s.framesDecoded ?? 0,
            framesDropped: s.framesDropped ?? 0,
            framesReceived: s.framesReceived ?? 0,
            bytesReceived: s.bytesReceived ?? 0,
            packetsReceived: s.packetsReceived ?? 0,
            packetsLost: s.packetsLost ?? 0,
            jitterMs: typeof s.jitter === 'number' ? s.jitter * 1000 : null,
            frameWidth: s.frameWidth ?? null,
            frameHeight: s.frameHeight ?? null,
            framesPerSecond: s.framesPerSecond ?? null,
            // Cumulative seconds the decoder has been stalled waiting for
            // data. A rising freeze count with a rising framesDecoded is a
            // viewer who is technically receiving and visibly stuttering.
            freezeCount: s.freezeCount ?? 0,
            totalFreezesDuration: s.totalFreezesDuration ?? 0,
            timestamp: s.timestamp,
          };
        }
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
          out.audio = {
            bytesReceived: s.bytesReceived ?? 0,
            packetsReceived: s.packetsReceived ?? 0,
            packetsLost: s.packetsLost ?? 0,
            jitterMs: typeof s.jitter === 'number' ? s.jitter * 1000 : null,
            timestamp: s.timestamp,
          };
        }
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
          if (typeof s.currentRoundTripTime === 'number') {
            out.roundTripTimeMs = s.currentRoundTripTime * 1000;
          }
          if (typeof s.availableIncomingBitrate === 'number') {
            out.availableIncomingBitrate = s.availableIncomingBitrate;
          }
        }
      });
    }
    return out;
  };

  /** Send-side equivalent, for the host page. */
  window.__rawSendStats = async (tag, room) => {
    const pcs = window.__pcsFor(tag, room);
    const out = { video: null, audio: null, roundTripTimeMs: null };
    for (const pc of pcs) {
      let report;
      try {
        report = await pc.getStats();
      } catch {
        continue;
      }
      report.forEach((s) => {
        if (s.type === 'outbound-rtp' && s.kind === 'video') {
          // A simulcast sender reports one outbound-rtp per layer; keep the
          // largest, which is the layer the resolution claim refers to.
          const candidate = {
            bytesSent: s.bytesSent ?? 0,
            packetsSent: s.packetsSent ?? 0,
            framesEncoded: s.framesEncoded ?? 0,
            frameWidth: s.frameWidth ?? null,
            frameHeight: s.frameHeight ?? null,
            framesPerSecond: s.framesPerSecond ?? null,
            timestamp: s.timestamp,
          };
          if (!out.video || (candidate.frameWidth ?? 0) > (out.video.frameWidth ?? 0)) {
            out.video = candidate;
          }
        }
        if (s.type === 'outbound-rtp' && s.kind === 'audio') {
          out.audio = { bytesSent: s.bytesSent ?? 0, packetsSent: s.packetsSent ?? 0, timestamp: s.timestamp };
        }
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
          if (typeof s.currentRoundTripTime === 'number') out.roundTripTimeMs = s.currentRoundTripTime * 1000;
        }
      });
    }
    return out;
  };
})();
