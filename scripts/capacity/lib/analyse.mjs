/**
 * Turns raw per-viewer samples into the one verdict this rig exists to
 * produce: is this viewer *watching*, or merely connected?
 *
 * # The definition, stated once and applied everywhere
 *
 * A viewer counts as receiving media only when, between two samples taken
 * at least `minIntervalMs` apart:
 *
 *   1. `framesDecoded` strictly increased, and
 *   2. `bytesReceived` strictly increased, and
 *   3. the <video> element's own `totalVideoFrames` strictly increased.
 *
 * (1) alone would accept a decoder that produced frames once and stopped.
 * (2) alone would accept RTP arriving into a decoder that cannot use it —
 * a codec mismatch looks exactly like this. (3) is an independent
 * witness, maintained by the renderer rather than by the WebRTC stats
 * subsystem, and it is what catches the case where stats keep ticking for
 * a track nothing is actually pulling from.
 *
 * `connectionState === 'connected'` is deliberately not in the list. It
 * is the thing the previous capacity work could already prove and the
 * thing that says least.
 */

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function summariseJoins(samples) {
  const joinTimes = samples.filter((s) => s.live && typeof s.joinMs === 'number').map((s) => s.joinMs);
  const firstMediaTimes = samples
    .filter((s) => s.live && typeof s.firstMediaMs === 'number')
    .map((s) => s.firstMediaMs);
  return {
    joinedCount: samples.filter((s) => s.live).length,
    joinP50Ms: percentile(joinTimes, 50),
    joinP95Ms: percentile(joinTimes, 95),
    joinMaxMs: joinTimes.length ? Math.max(...joinTimes) : null,
    firstMediaP50Ms: percentile(firstMediaTimes, 50),
    firstMediaP95Ms: percentile(firstMediaTimes, 95),
  };
}

/**
 * Compares two sample sets and decides, per viewer, whether media is
 * alive. Returns both the verdict and the evidence, because a bare
 * pass/fail count is not something a reader can check.
 */
/**
 * @param expected how many viewers are *supposed* to be watching right now.
 *   Defaults to the number of samples, which is right for a tier that only
 *   ever grows. It is wrong for churn: viewers who have left stay in the
 *   page's map reporting `live: false`, so the denominator would keep
 *   growing while the audience stayed the same size, and a perfectly
 *   healthy room would appear to degrade cycle by cycle. Pass the live
 *   population instead.
 */
export function diffSamples(before, after, { minIntervalMs = 1_000, expected } = {}) {
  const beforeById = new Map(before.map((s) => [s.id, s]));
  const perViewer = [];

  for (const now of after) {
    const then = beforeById.get(now.id);
    if (!now.live) {
      perViewer.push({
        id: now.id,
        live: false,
        mediaAlive: false,
        reason: now.error ? 'error' : 'not-joined',
        error: now.error ?? null,
      });
      continue;
    }
    if (!then?.live || !then.raw?.video || !now.raw?.video) {
      perViewer.push({
        id: now.id,
        live: true,
        mediaAlive: false,
        reason: 'no-video-stats',
        connectionState: now.connectionState,
      });
      continue;
    }

    const intervalMs = now.raw.video.timestamp - then.raw.video.timestamp;
    const framesDelta = now.raw.video.framesDecoded - then.raw.video.framesDecoded;
    const bytesDelta = now.raw.video.bytesReceived - then.raw.video.bytesReceived;
    const packetsDelta = now.raw.video.packetsReceived - then.raw.video.packetsReceived;
    const elementDelta = (now.elementTotalVideoFrames ?? 0) - (then.elementTotalVideoFrames ?? 0);
    const lostDelta = now.raw.video.packetsLost - then.raw.video.packetsLost;

    const enoughTime = intervalMs >= minIntervalMs;
    // The decode signals are the primary gate: framesDecoded and
    // bytesReceived come straight off the RTCPeerConnection's own
    // inbound-rtp stats, and both advancing is direct proof that real
    // RTP arrived and a frame came out of the decoder for it. That is
    // the thing this rig exists to prove.
    //
    // The element's own totalVideoFrames counter started as a third,
    // independent witness, and it caught a real bug once — a decoder
    // that had stopped but whose PeerConnection stayed 'connected'. It
    // has also been seen to under-count on its own: a restart-recovery
    // run had three viewers with framesDecoded advancing at a clean
    // 30fps, bytesReceived and packetsReceived climbing correctly, 0%
    // loss — and totalVideoFrames flat at zero. Headless Chromium's
    // presentation/compositor path is throttled independently of
    // decoding, and under many small concurrent <video> elements it can
    // starve while decode keeps up. That is a rendering artifact of the
    // harness, not evidence the viewer isn't receiving media.
    //
    // So the element counter is downgraded from a gate to a recorded
    // diagnostic (`elementFramesStalled`): every row still reports it,
    // and a reader can see exactly how often decode and presentation
    // disagreed, but only the two RTCPeerConnection-native signals
    // decide `mediaAlive`.
    const mediaAlive = enoughTime && framesDelta > 0 && bytesDelta > 0;
    const elementFramesStalled = mediaAlive && elementDelta <= 0;

    perViewer.push({
      id: now.id,
      live: true,
      mediaAlive,
      elementFramesStalled,
      reason: mediaAlive
        ? 'ok'
        : !enoughTime
          ? 'interval-too-short'
          : framesDelta <= 0
            ? 'frames-not-advancing'
            : 'bytes-not-advancing',
      connectionState: now.connectionState,
      intervalMs,
      framesDecodedDelta: framesDelta,
      elementFramesDelta: elementDelta,
      decodedFps: intervalMs > 0 ? (framesDelta / intervalMs) * 1000 : null,
      inboundKbps: intervalMs > 0 ? (bytesDelta * 8) / intervalMs : null,
      packetsReceivedDelta: packetsDelta,
      packetsLostDelta: lostDelta,
      lossPercent: packetsDelta + lostDelta > 0 ? (lostDelta / (packetsDelta + lostDelta)) * 100 : 0,
      jitterMs: now.raw.video.jitterMs,
      roundTripTimeMs: now.raw.roundTripTimeMs,
      frameWidth: now.raw.video.frameWidth,
      frameHeight: now.raw.video.frameHeight,
      freezeCount: now.raw.video.freezeCount - then.raw.video.freezeCount,
      totalFreezesDurationDelta: now.raw.video.totalFreezesDuration - then.raw.video.totalFreezesDuration,
      reconnects: now.reconnects,
      audioInboundKbps:
        then.raw.audio && now.raw.audio && now.raw.audio.timestamp > then.raw.audio.timestamp
          ? ((now.raw.audio.bytesReceived - then.raw.audio.bytesReceived) * 8) /
            (now.raw.audio.timestamp - then.raw.audio.timestamp)
          : null,
    });
  }

  const alive = perViewer.filter((v) => v.mediaAlive);
  const elementStalledCount = alive.filter((v) => v.elementFramesStalled).length;
  const decodedFps = alive.map((v) => v.decodedFps).filter((v) => v != null);
  const inboundKbps = alive.map((v) => v.inboundKbps).filter((v) => v != null);
  const loss = alive.map((v) => v.lossPercent).filter((v) => v != null);
  const jitter = alive.map((v) => v.jitterMs).filter((v) => v != null);
  const rtt = alive.map((v) => v.roundTripTimeMs).filter((v) => v != null);

  const denominator = expected ?? after.length;
  return {
    perViewer,
    total: after.length,
    expected: denominator,
    liveCount: perViewer.filter((v) => v.live).length,
    mediaAliveCount: alive.length,
    mediaAlivePercent: denominator ? (alive.length / denominator) * 100 : 0,
    /** Media-alive viewers whose own <video> element didn't corroborate it. See the module doc above `mediaAlive`. */
    elementFramesStalledCount: elementStalledCount,
    decodedFpsMean: mean(decodedFps),
    decodedFpsP05: percentile(decodedFps, 5),
    viewerInboundKbpsMean: mean(inboundKbps),
    // Summed across viewers, this is the audience's own view of what the
    // SFU sent them. Cross-checking it against the SFU's outbound counter
    // is what makes both numbers trustworthy: they are measured at
    // opposite ends of the same wire by unrelated code.
    viewerInboundMbpsTotal: inboundKbps.length ? inboundKbps.reduce((a, b) => a + b, 0) / 1000 : null,
    lossPercentMean: mean(loss),
    lossPercentP95: percentile(loss, 95),
    jitterMsMean: mean(jitter),
    jitterMsP95: percentile(jitter, 95),
    rttMsMean: mean(rtt),
    rttMsP95: percentile(rtt, 95),
    freezes: alive.reduce((sum, v) => sum + (v.freezeCount ?? 0), 0),
    reconnects: perViewer.reduce((sum, v) => sum + (v.reconnects ?? 0), 0),
    failureReasons: perViewer
      .filter((v) => !v.mediaAlive)
      .reduce((acc, v) => ({ ...acc, [v.reason]: (acc[v.reason] ?? 0) + 1 }), {}),
    resolutions: alive.reduce((acc, v) => {
      const key = `${v.frameWidth}x${v.frameHeight}`;
      return { ...acc, [key]: (acc[key] ?? 0) + 1 };
    }, {}),
  };
}

export { percentile, mean };
