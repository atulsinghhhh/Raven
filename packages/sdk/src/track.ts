import { normalizeTrackStats, pickBestLayer, type RawTrackStats, type TrackStats } from './internal/telemetry/track-stats';

export type { TrackStats } from './internal/telemetry/track-stats';
export type TrackKind = 'camera' | 'microphone' | 'screenShare' | 'unknown';

/**
 * Structural interface, not a livekit-client import — livekit-client's
 * own Track class already matches this shape, and it's easy to fake in
 * tests.
 */
export interface TrackDelegate {
  readonly mediaStreamTrack: MediaStreamTrack;
  readonly mediaStream?: MediaStream;
  readonly isMuted: boolean;
  attach(element?: HTMLMediaElement): HTMLMediaElement;
  // livekit-client's detach() returns one element or an array depending on
  // whether you pass an argument — typed loosely to match both. Track.detach()
  // below always normalizes to an array for a stable public API.
  detach(element?: HTMLMediaElement): HTMLMediaElement | HTMLMediaElement[];
}

/** Base class for both local and remote tracks. Never exposes RTCRtpSender/Receiver. */
export abstract class Track {
  readonly kind: TrackKind;
  protected readonly delegate: TrackDelegate;

  constructor(delegate: TrackDelegate, kind: TrackKind) {
    this.delegate = delegate;
    this.kind = kind;
  }

  /** The underlying native track, for the rare case advanced access is needed. */
  get mediaStreamTrack(): MediaStreamTrack {
    return this.delegate.mediaStreamTrack;
  }

  get mediaStream(): MediaStream | undefined {
    return this.delegate.mediaStream;
  }

  get isMuted(): boolean {
    return this.delegate.isMuted;
  }

  /** Attaches this track to a `<video>`/`<audio>` element, creating one if omitted. */
  attach(element?: HTMLMediaElement): HTMLMediaElement {
    return this.delegate.attach(element);
  }

  /** Detaches this track from one element, or from all elements if omitted. */
  detach(element?: HTMLMediaElement): HTMLMediaElement[] {
    const result = this.delegate.detach(element);
    return Array.isArray(result) ? result : [result];
  }
}

export interface LocalTrackDelegate extends TrackDelegate {
  // livekit-client's mute()/unmute() resolve to `this` — typed as `unknown`
  // so that and a plain Promise<void> fake both satisfy the interface
  mute(): Promise<unknown>;
  unmute(): Promise<unknown>;
  /**
   * Optional so a delegate that predates stats support (or a test double
   * that doesn't need them) still satisfies this interface unchanged — a
   * purely additive capability, never a required one. An array covers
   * livekit-client's video path, which reports one entry per simulcast
   * encoding layer rather than a single stream.
   */
  getSenderStats?(): Promise<RawTrackStats | RawTrackStats[] | undefined>;
}

export interface RemoteTrackDelegate extends TrackDelegate {
  /** Optional for the same reason as `LocalTrackDelegate.getSenderStats`. */
  getReceiverStats?(): Promise<RawTrackStats | undefined>;
}

/** A track captured locally (camera/microphone/screen share) — published or not yet published. */
export class LocalTrack extends Track {
  private readonly localDelegate: LocalTrackDelegate;
  private lastSample?: RawTrackStats;

  constructor(delegate: LocalTrackDelegate, kind: TrackKind) {
    super(delegate, kind);
    this.localDelegate = delegate;
  }

  async mute(): Promise<void> {
    await this.localDelegate.mute();
  }

  async unmute(): Promise<void> {
    await this.localDelegate.unmute();
  }

  /** Stops the underlying device capture. Publish state is managed by Room.unpublish(). */
  stop(): void {
    this.mediaStreamTrack.stop();
  }

  /**
   * Live send-side stats for this track — bitrate, packet loss, jitter,
   * RTT (audio only), resolution/fps (video only). `undefined` when the
   * adapter can't supply them (no `getSenderStats` on the delegate, or the
   * underlying call itself resolved to nothing) rather than a
   * zeroed-out object — see the module doc on why that distinction matters.
   *
   * Call this periodically (`Room.getConnectionStats()` does, every few
   * seconds) rather than once: bitrate needs two samples to compute, so
   * the very first call after a track starts always omits it.
   */
  async getStats(): Promise<TrackStats | undefined> {
    const raw = await this.localDelegate.getSenderStats?.();
    if (!raw) {
      return undefined;
    }

    const sample = Array.isArray(raw) ? pickBestLayer(raw) : raw;
    if (!sample) {
      return undefined;
    }

    const stats = normalizeTrackStats(sample, this.lastSample, this.kind, 'send');
    this.lastSample = sample;
    return stats;
  }
}

/** A track received from a remote participant via the SFU. */
export class RemoteTrack extends Track {
  private readonly remoteDelegate: RemoteTrackDelegate;
  private lastSample?: RawTrackStats;

  constructor(delegate: RemoteTrackDelegate, kind: TrackKind) {
    super(delegate, kind);
    this.remoteDelegate = delegate;
  }

  /** Live receive-side stats for this track. See `LocalTrack.getStats()` for the shape and its caveats. */
  async getStats(): Promise<TrackStats | undefined> {
    const raw = await this.remoteDelegate.getReceiverStats?.();
    if (!raw) {
      return undefined;
    }

    const stats = normalizeTrackStats(raw, this.lastSample, this.kind, 'receive');
    this.lastSample = raw;
    return stats;
  }
}
