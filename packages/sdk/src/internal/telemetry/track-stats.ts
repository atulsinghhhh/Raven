import type { TrackKind } from '../../track';

/**
 * Structural match for livekit-client's `{Audio,Video}{Sender,Receiver}Stats`
 * — duck-typed rather than imported, so this file (and everything that
 * depends on it) stays usable if the SFU adapter is ever swapped. Every
 * field here is a raw WebRTC stat, in the units the spec defines them in
 * (seconds, not milliseconds) — `normalizeTrackStats` below is where that
 * gets converted into Raven's own vocabulary.
 */
export interface RawTrackStats {
  type?: 'audio' | 'video';
  /** Epoch ms — when this sample was taken. Used to compute bitrate against a previous sample. */
  timestamp: number;
  /** Seconds, per the WebRTC spec. */
  jitter?: number;
  packetsLost?: number;
  packetsSent?: number;
  packetsReceived?: number;
  /** Seconds. Only ever populated on an outbound audio stream — WebRTC does not report RTT for video or for the receive direction. */
  roundTripTime?: number;
  bytesSent?: number;
  bytesReceived?: number;
  /** Receive-direction video only; WebRTC does not surface this for audio or for the send direction. */
  mimeType?: string;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
}

/**
 * Raven's own normalized shape — never raw WebRTC/livekit types on a
 * public class. Every field is optional and omitted rather than set to
 * `0`/`null` when the browser or SFU didn't report it: a 0% packet loss
 * figure and "we don't know" are different facts, and this never fabricates
 * the first to paper over the second.
 */
export interface TrackStats {
  kind: TrackKind;
  /** 'send' for a track this side published, 'receive' for one it subscribed to. */
  direction: 'send' | 'receive';
  /** Bytes/sec, computed from two consecutive samples. Undefined on the first sample of a track — there is nothing yet to take a delta against. */
  bitrateBps?: number;
  packetsLost?: number;
  /** 0-100. See the module doc for why this is an approximation, not a WebRTC-spec figure. */
  packetLossPercent?: number;
  jitterMs?: number;
  roundTripTimeMs?: number;
  /** Populated only for a received video track — see `RawTrackStats.mimeType`. */
  codec?: string;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
}

const MS_PER_SECOND = 1000;

/**
 * Converts one raw WebRTC sample into Raven's `TrackStats`, using the
 * previous sample (if any) to compute bitrate as a delta over time.
 *
 * Packet loss is reported as a percentage using the standard
 * loss-rate approximation (`lost / (lost + sent-or-received)`) that most
 * WebRTC quality tooling uses. It is not the RFC 3550 formula and is not
 * exact — `packetsLost` is a cumulative, remote-reported count with its
 * own delivery lag — but it is close enough to be a useful signal and
 * costs nothing extra to compute from stats already being collected.
 */
export function normalizeTrackStats(
  raw: RawTrackStats,
  previous: RawTrackStats | undefined,
  kind: TrackKind,
  direction: 'send' | 'receive',
): TrackStats {
  const stats: TrackStats = { kind, direction };

  if (typeof raw.jitter === 'number') {
    stats.jitterMs = raw.jitter * MS_PER_SECOND;
  }
  if (typeof raw.roundTripTime === 'number') {
    stats.roundTripTimeMs = raw.roundTripTime * MS_PER_SECOND;
  }
  if (typeof raw.mimeType === 'string') {
    stats.codec = raw.mimeType;
  }
  if (typeof raw.frameWidth === 'number') stats.frameWidth = raw.frameWidth;
  if (typeof raw.frameHeight === 'number') stats.frameHeight = raw.frameHeight;
  if (typeof raw.framesPerSecond === 'number') stats.framesPerSecond = raw.framesPerSecond;

  if (typeof raw.packetsLost === 'number') {
    stats.packetsLost = raw.packetsLost;

    const attempted = direction === 'send' ? raw.packetsSent : raw.packetsReceived;
    if (typeof attempted === 'number' && attempted + raw.packetsLost > 0) {
      stats.packetLossPercent = (raw.packetsLost / (attempted + raw.packetsLost)) * 100;
    }
  }

  const bytesField = direction === 'send' ? 'bytesSent' : 'bytesReceived';
  const currentBytes = raw[bytesField];
  const previousBytes = previous?.[bytesField];

  if (typeof currentBytes === 'number' && typeof previousBytes === 'number') {
    const elapsedSeconds = (raw.timestamp - previous!.timestamp) / MS_PER_SECOND;
    // A non-positive elapsed time means the samples are out of order or
    // identical (a caller polling faster than the underlying stats
    // actually refresh) — computing a rate from it would divide by zero
    // or invert the sign, so it is skipped rather than reported as junk.
    if (elapsedSeconds > 0 && currentBytes >= previousBytes) {
      stats.bitrateBps = ((currentBytes - previousBytes) * 8) / elapsedSeconds;
    }
  }

  return stats;
}

/**
 * `LocalVideoTrack.getSenderStats()` returns one entry per simulcast
 * encoding layer rather than a single stream. The highest-resolution
 * layer is the one worth reporting as "this track's" quality — the lower
 * layers exist for viewers on constrained connections, not to describe
 * what this participant is actually sending at its best.
 */
export function pickBestLayer(layers: RawTrackStats[]): RawTrackStats | undefined {
  return layers.reduce<RawTrackStats | undefined>((best, layer) => {
    const bestWidth = best?.frameWidth ?? -1;
    const layerWidth = layer.frameWidth ?? -1;
    return layerWidth > bestWidth ? layer : best;
  }, undefined);
}
