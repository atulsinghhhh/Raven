import type { EffectsPipeline } from '@corvidhq/effects';
import { normalizeTrackStats, pickBestLayer, type RawTrackStats, type TrackStats } from './internal/telemetry/track-stats';
import { RTCError } from './errors';

export type { TrackStats } from './internal/telemetry/track-stats';
export type TrackKind = 'camera' | 'microphone' | 'screenShare' | 'unknown';

/**
 * Structural interface rather than a concrete class, so a track can be
 * backed by a raw `MediaStreamTrack` (which is what the native adapter
 * does) or by a test double, without either having to inherit anything.
 */
export interface TrackDelegate {
  readonly mediaStreamTrack: MediaStreamTrack;
  readonly mediaStream?: MediaStream;
  readonly isMuted: boolean;
  attach(element?: HTMLMediaElement): HTMLMediaElement;
  // Typed loosely to accept a delegate that returns either one element or
  // an array. Track.detach() below always normalizes to an array, so the
  // public API is stable regardless.
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
  // Typed as `unknown` so a delegate resolving to anything (or to
  // nothing) satisfies the interface — callers here never use the value.
  mute(): Promise<unknown>;
  unmute(): Promise<unknown>;
  /**
   * Optional so a delegate that predates stats support (or a test double
   * that doesn't need them) still satisfies this interface unchanged — a
   * purely additive capability, never a required one. An array covers the
   * video path, where a simulcast sender reports one `outbound-rtp` entry
   * per encoding layer rather than a single stream.
   */
  getSenderStats?(): Promise<RawTrackStats | RawTrackStats[] | undefined>;
  /**
   * Swaps the underlying MediaStreamTrack on an already-published sender.
   * `RTCRtpSender.replaceTrack()` does this without renegotiating, so
   * nobody else in the room observes anything. Optional for the same
   * reason as getSenderStats — a delegate that predates Raven Effects
   * still satisfies this interface, and LocalTrack.attachEffects() checks
   * for it explicitly rather than assuming every delegate supports it.
   */
  replaceTrack?(track: MediaStreamTrack, userProvidedTrack?: boolean): Promise<unknown>;
}

export interface RemoteTrackDelegate extends TrackDelegate {
  /** Optional for the same reason as `LocalTrackDelegate.getSenderStats`. */
  getReceiverStats?(): Promise<RawTrackStats | undefined>;
}

/** A track captured locally (camera/microphone/screen share) — published or not yet published. */
export class LocalTrack extends Track {
  private readonly localDelegate: LocalTrackDelegate;
  private lastSample?: RawTrackStats;
  private attachedEffectsPipeline?: EffectsPipeline;
  private preEffectsMediaStreamTrack?: MediaStreamTrack;

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
   * Raven Effects (`@corvidhq/effects`) integration point — Camera → Raven
   * Video Track → Effects Pipeline → Processed Video Track → Raven RTC.
   * Runs `pipeline` against this track's live camera feed and, if already
   * published, swaps the sender's `MediaStreamTrack` in place via the
   * adapter's `replaceTrack()` — no renegotiation, no reconnect, audio and
   * the rest of the room are untouched. Camera-only today; screen share and
   * microphone aren't supported.
   *
   * If the pipeline can't run on this device (no WebGL2/Canvas2D/
   * captureStream), it degrades to the original track automatically — the
   * call keeps working either way.
   */
  async attachEffects(pipeline: EffectsPipeline): Promise<void> {
    if (this.kind !== 'camera') {
      throw new RTCError('MEDIA_ERROR', `attachEffects() is only supported on camera tracks, not "${this.kind}".`);
    }
    if (!this.localDelegate.replaceTrack) {
      throw new RTCError('MEDIA_ERROR', 'This track cannot be swapped in place — the current adapter does not support replaceTrack().');
    }
    if (this.attachedEffectsPipeline) {
      await this.detachEffects();
    }

    const original = this.mediaStreamTrack;
    const processed = await pipeline.attachToTrack(original);
    if (processed !== original) {
      await this.localDelegate.replaceTrack(processed, true);
    }
    this.attachedEffectsPipeline = pipeline;
    this.preEffectsMediaStreamTrack = original;
  }

  /** Reverts to the unmodified camera track and releases the pipeline's engine resources. */
  async detachEffects(): Promise<void> {
    if (!this.attachedEffectsPipeline) return;
    this.attachedEffectsPipeline.detach();
    if (this.preEffectsMediaStreamTrack && this.localDelegate.replaceTrack) {
      await this.localDelegate.replaceTrack(this.preEffectsMediaStreamTrack, true);
    }
    this.attachedEffectsPipeline = undefined;
    this.preEffectsMediaStreamTrack = undefined;
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
