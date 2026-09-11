import type { EffectsPipeline } from '@ravenkash/effects';
import {
  normalizeTrackStats,
  pickBestLayer,
  type RawTrackStats,
  type TrackStats,
} from './internal/telemetry/track-stats';
import { RTCError } from './errors';

export type { TrackStats } from './internal/telemetry/track-stats';
export type TrackKind = 'camera' | 'microphone' | 'screenShare' | 'unknown';

/**
 * A structural interface, not a concrete class, so a track can be backed by
 * a raw `MediaStreamTrack` (what the native adapter does) or by a test
 * double, with neither having to inherit anything.
 */
export interface TrackDelegate {
  readonly mediaStreamTrack: MediaStreamTrack;
  readonly mediaStream?: MediaStream;
  readonly isMuted: boolean;
  attach(element?: HTMLMediaElement): HTMLMediaElement;
  // Typed loosely so a delegate can return one element or an array.
  // Track.detach() below always normalizes to an array, so the public API
  // looks the same either way.
  detach(element?: HTMLMediaElement): HTMLMediaElement | HTMLMediaElement[];
}

/** Base class for local and remote tracks alike. Never leaks RTCRtpSender/Receiver. */
export abstract class Track {
  readonly kind: TrackKind;
  protected readonly delegate: TrackDelegate;

  constructor(delegate: TrackDelegate, kind: TrackKind) {
    this.delegate = delegate;
    this.kind = kind;
  }

  /** The underlying native track, for the rare occasion you need to go deeper. */
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
  // Typed `unknown` so a delegate resolving to anything, or to nothing at
  // all, still satisfies the interface. Nobody here uses the value.
  mute(): Promise<unknown>;
  unmute(): Promise<unknown>;
  /**
   * Optional, so a delegate that predates stats support (or a test double
   * that doesn't care) still satisfies this interface untouched. Purely
   * additive, never required. The array form covers video, where a
   * simulcast sender reports one `outbound-rtp` entry per encoding layer
   * instead of a single stream.
   */
  getSenderStats?(): Promise<RawTrackStats | RawTrackStats[] | undefined>;
  /**
   * Swaps the underlying MediaStreamTrack on an already-published sender.
   * `RTCRtpSender.replaceTrack()` manages this without renegotiating, so
   * nobody else in the room sees a thing. Optional for the same reason as
   * getSenderStats: a delegate predating Livqeno Effects still satisfies
   * this interface, and LocalTrack.attachEffects() checks for it rather
   * than assuming every delegate has it.
   */
  replaceTrack?(track: MediaStreamTrack, userProvidedTrack?: boolean): Promise<unknown>;
}

export interface RemoteTrackDelegate extends TrackDelegate {
  /** Optional for the same reason as `LocalTrackDelegate.getSenderStats`. */
  getReceiverStats?(): Promise<RawTrackStats | undefined>;
}

/** A locally captured track (camera, microphone or screen share), published or not. */
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

  /** Stops the underlying device capture. Publish state belongs to Room.unpublish(). */
  stop(): void {
    this.mediaStreamTrack.stop();
  }

  /**
   * Where Livqeno Effects (`@ravenkash/effects`) plugs in. The chain is
   * Camera → Livqeno Video Track → Effects Pipeline → Processed Video Track →
   * Livqeno RTC.
   *
   * Runs `pipeline` against this track's live camera feed and, if the track
   * is already published, swaps the sender's `MediaStreamTrack` in place
   * through the adapter's `replaceTrack()`. No renegotiation, no reconnect,
   * audio and the rest of the room untouched. Camera only for now; screen
   * share and microphone aren't supported.
   *
   * Can't run the pipeline on this device (no WebGL2, Canvas2D or
   * captureStream)? It falls back to the original track on its own. The
   * call keeps working either way.
   */
  async attachEffects(pipeline: EffectsPipeline): Promise<void> {
    if (this.kind !== 'camera') {
      throw new RTCError('MEDIA_ERROR', `attachEffects() is only supported on camera tracks, not "${this.kind}".`);
    }
    if (!this.localDelegate.replaceTrack) {
      throw new RTCError(
        'MEDIA_ERROR',
        'This track cannot be swapped in place; the current adapter does not support replaceTrack().',
      );
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

  /** Goes back to the unmodified camera track and frees the pipeline's engine resources. */
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
   * Live send-side stats for this track: bitrate, packet loss, jitter, RTT
   * (audio only), resolution and fps (video only).
   *
   * You get `undefined`, not a zeroed-out object, when the adapter can't
   * supply them, either because the delegate has no `getSenderStats` or
   * because the underlying call resolved to nothing. The module doc covers
   * why that distinction matters.
   *
   * Call it periodically instead of once. `Room.getConnectionStats()` does,
   * every few seconds. Bitrate needs two samples to compute, so the first
   * call after a track starts always omits it.
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

/** A track received from a remote participant, via the SFU. */
export class RemoteTrack extends Track {
  private readonly remoteDelegate: RemoteTrackDelegate;
  private lastSample?: RawTrackStats;

  constructor(delegate: RemoteTrackDelegate, kind: TrackKind) {
    super(delegate, kind);
    this.remoteDelegate = delegate;
  }

  /** Live receive-side stats. `LocalTrack.getStats()` covers the shape and the caveats. */
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
