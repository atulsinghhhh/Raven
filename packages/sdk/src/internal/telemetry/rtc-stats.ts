import type { RawTrackStats } from './track-stats';

export type { RawTrackStats } from './track-stats';

/**
 * Reads an `RTCStatsReport` into the flat samples `normalizeTrackStats`
 * already understands.
 *
 * # Why this needs to walk the report rather than pick one entry
 *
 * The interesting numbers for one track are spread across several stats
 * objects, and which object holds what differs by direction:
 *
 * - `outbound-rtp` / `inbound-rtp` hold bytes, packets, and video
 *   resolution/framerate.
 * - `remote-inbound-rtp` holds the *remote* end's view of a stream we are
 *   sending — which is the only place round-trip time and the loss the
 *   far side actually saw are reported. Send-side loss cannot be measured
 *   locally at all; the sender only knows what it handed to the network.
 * - `codec` holds the mime type, referenced by id rather than inlined.
 *
 * So a faithful sample is a join across those. Doing it here, once, is
 * what lets `TrackStats` stay a flat, honest shape rather than exposing
 * the report's structure to callers.
 *
 * Anything the report does not contain is left `undefined`. Nothing here
 * substitutes a zero for a missing measurement — spec §19 forbids
 * inventing quality figures, and "0% loss" versus "no report yet" is
 * exactly the distinction that matters.
 */
export function rawStatsFromReport(
  report: RTCStatsReport,
  wanted: 'outbound-rtp' | 'inbound-rtp',
): RawTrackStats[] {
  const codecs = new Map<string, string>();
  const remoteInbound: RemoteInboundStats[] = [];
  const rtpEntries: RtpStats[] = [];

  report.forEach((entry) => {
    const stats = entry as { type?: string } & Record<string, unknown>;
    switch (stats.type) {
      case 'codec':
        if (typeof stats.id === 'string' && typeof stats.mimeType === 'string') {
          codecs.set(stats.id, stats.mimeType);
        }
        break;
      case 'remote-inbound-rtp':
        remoteInbound.push(stats as unknown as RemoteInboundStats);
        break;
      case wanted:
        rtpEntries.push(stats as unknown as RtpStats);
        break;
      default:
        break;
    }
  });

  return rtpEntries.map((rtp) => toRawStats(rtp, wanted, codecs, remoteInbound));
}

interface RtpStats {
  id?: string;
  ssrc?: number;
  kind?: string;
  mediaType?: string;
  timestamp?: number;
  codecId?: string;
  bytesSent?: number;
  bytesReceived?: number;
  packetsSent?: number;
  packetsReceived?: number;
  packetsLost?: number;
  jitter?: number;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  mimeType?: string;
}

interface RemoteInboundStats {
  ssrc?: number;
  localId?: string;
  roundTripTime?: number;
  packetsLost?: number;
  jitter?: number;
}

function toRawStats(
  rtp: RtpStats,
  direction: 'outbound-rtp' | 'inbound-rtp',
  codecs: Map<string, string>,
  remoteInbound: RemoteInboundStats[],
): RawTrackStats {
  const kind = rtp.kind ?? rtp.mediaType;
  const sample: RawTrackStats = {
    type: kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : undefined,
    // `RTCStats.timestamp` is a DOMHighResTimeStamp relative to the time
    // origin, and `normalizeTrackStats` only ever uses it as a delta
    // against a previous sample, so its epoch does not matter. Falling
    // back to Date.now() keeps the delta usable in the rare case the
    // browser omitted it.
    timestamp: typeof rtp.timestamp === 'number' ? rtp.timestamp : Date.now(),
  };

  if (typeof rtp.jitter === 'number') sample.jitter = rtp.jitter;
  if (typeof rtp.frameWidth === 'number') sample.frameWidth = rtp.frameWidth;
  if (typeof rtp.frameHeight === 'number') sample.frameHeight = rtp.frameHeight;
  if (typeof rtp.framesPerSecond === 'number') sample.framesPerSecond = rtp.framesPerSecond;

  const mimeType = rtp.mimeType ?? (rtp.codecId ? codecs.get(rtp.codecId) : undefined);
  if (mimeType) sample.mimeType = mimeType;

  if (direction === 'outbound-rtp') {
    if (typeof rtp.bytesSent === 'number') sample.bytesSent = rtp.bytesSent;
    if (typeof rtp.packetsSent === 'number') sample.packetsSent = rtp.packetsSent;

    // Loss and RTT for a stream we are sending are only knowable from the
    // receiver's report. Matched by `localId` where the browser provides
    // it, falling back to SSRC — Safari has historically been
    // inconsistent about `localId`, and an unmatched report is worse than
    // a slightly looser match.
    const feedback =
      remoteInbound.find((remote) => rtp.id && remote.localId === rtp.id) ??
      remoteInbound.find((remote) => rtp.ssrc !== undefined && remote.ssrc === rtp.ssrc);
    if (feedback) {
      if (typeof feedback.roundTripTime === 'number') sample.roundTripTime = feedback.roundTripTime;
      if (typeof feedback.packetsLost === 'number') sample.packetsLost = feedback.packetsLost;
      if (sample.jitter === undefined && typeof feedback.jitter === 'number') {
        sample.jitter = feedback.jitter;
      }
    }
    return sample;
  }

  if (typeof rtp.bytesReceived === 'number') sample.bytesReceived = rtp.bytesReceived;
  if (typeof rtp.packetsReceived === 'number') sample.packetsReceived = rtp.packetsReceived;
  if (typeof rtp.packetsLost === 'number') sample.packetsLost = rtp.packetsLost;
  return sample;
}

/**
 * The negotiated ICE candidate pair's round-trip time, if the connection
 * has one.
 *
 * Useful in addition to per-track RTT because it exists for a
 * video-only or receive-only connection, where no audio `remote-inbound-rtp`
 * report is available to carry one.
 */
export async function connectionRoundTripTimeMs(
  connection: RTCPeerConnection,
): Promise<number | undefined> {
  const report = await connection.getStats();
  let rttSeconds: number | undefined;

  report.forEach((entry) => {
    const stats = entry as { type?: string } & Record<string, unknown>;
    if (stats.type !== 'candidate-pair') {
      return;
    }
    // Only the pair actually in use. A connection gathers several and
    // reports them all; the others' timings describe paths not being
    // taken.
    if (stats.state !== 'succeeded' || stats.nominated !== true) {
      return;
    }
    if (typeof stats.currentRoundTripTime === 'number') {
      rttSeconds = stats.currentRoundTripTime;
    }
  });

  return rttSeconds === undefined ? undefined : rttSeconds * 1000;
}
