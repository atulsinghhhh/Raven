export type TrackKind = 'camera' | 'microphone' | 'screenShare' | 'unknown';

/**
 * Structural interface, not a livekit-client import — satisfied directly by
 * livekit-client's own Track class (attach/detach/mediaStreamTrack/mediaStream
 * already match this shape), and trivially fakeable in tests.
 */
export interface TrackDelegate {
  readonly mediaStreamTrack: MediaStreamTrack;
  readonly mediaStream?: MediaStream;
  readonly isMuted: boolean;
  attach(element?: HTMLMediaElement): HTMLMediaElement;
  // livekit-client's own detach() overloads return a single element when
  // called with one, and an array when called with none — typed loosely
  // here to structurally match both; Track.detach() below always
  // normalizes to an array for a stable public API.
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
  // Livekit-client's mute()/unmute() resolve to `this`; typed as `unknown`
  // here so both that and a plain Promise<void> fake satisfy the interface.
  mute(): Promise<unknown>;
  unmute(): Promise<unknown>;
}

/** A track captured locally (camera/microphone/screen share) — published or not yet published. */
export class LocalTrack extends Track {
  private readonly localDelegate: LocalTrackDelegate;

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
}

/** A track received from a remote participant via the SFU. */
export class RemoteTrack extends Track {}
