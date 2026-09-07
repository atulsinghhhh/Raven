import type { LocalTrackDelegate, RemoteTrackDelegate } from '../../track';
import { rawStatsFromReport, type RawTrackStats } from '../telemetry/rtc-stats';

/**
 * Attach/detach over a plain `MediaStreamTrack`.
 *
 * `Track.attach()` is the SDK's way of getting media onto a page without
 * the developer touching `srcObject`. What it has to do is small: wrap the
 * track in a `MediaStream`, point an element at it, and remember which
 * elements were attached so `detach()` can find them again.
 *
 * The element bookkeeping is the part worth being careful about. Without
 * it, `detach()` with no argument has nothing to detach *from*, and the
 * common cleanup path in a React effect silently leaks a playing video.
 */
abstract class NativeTrackDelegate {
  readonly mediaStreamTrack: MediaStreamTrack;
  private stream?: MediaStream;
  private readonly attachedElements = new Set<HTMLMediaElement>();

  constructor(mediaStreamTrack: MediaStreamTrack) {
    this.mediaStreamTrack = mediaStreamTrack;
  }

  get mediaStream(): MediaStream | undefined {
    if (!this.stream && typeof MediaStream !== 'undefined') {
      this.stream = new MediaStream([this.mediaStreamTrack]);
    }
    return this.stream;
  }

  attach(element?: HTMLMediaElement): HTMLMediaElement {
    const target = element ?? this.createElement();
    const stream = this.mediaStream;
    if (stream) {
      target.srcObject = stream;
    }
    // Autoplay policies block a video element that is not muted unless the
    // user has interacted with the page. A remote track has to be audible,
    // so it is not muted here; `autoplay` plus `playsInline` is what makes
    // it work in the cases that are allowed, and a caller who needs more
    // control passes their own element.
    target.autoplay = true;
    if (target instanceof HTMLVideoElement) {
      target.playsInline = true;
    }
    this.attachedElements.add(target);
    return target;
  }

  detach(element?: HTMLMediaElement): HTMLMediaElement | HTMLMediaElement[] {
    if (element) {
      element.srcObject = null;
      this.attachedElements.delete(element);
      return element;
    }

    const detached = Array.from(this.attachedElements);
    for (const attached of detached) {
      attached.srcObject = null;
    }
    this.attachedElements.clear();
    return detached;
  }

  /**
   * Swaps the track this delegate wraps.
   *
   * Called after `replaceTrack` on the sender succeeds, so that
   * `attach()`ed elements and `mediaStreamTrack` describe what is actually
   * being sent rather than the track that was replaced.
   */
  protected swapMediaStreamTrack(next: MediaStreamTrack): void {
    (this as { mediaStreamTrack: MediaStreamTrack }).mediaStreamTrack = next;
    this.stream = typeof MediaStream !== 'undefined' ? new MediaStream([next]) : undefined;
    const stream = this.stream;
    if (!stream) {
      return;
    }
    for (const element of this.attachedElements) {
      element.srcObject = stream;
    }
  }

  private createElement(): HTMLMediaElement {
    if (typeof document === 'undefined') {
      throw new Error('attach() without an element requires a DOM');
    }
    return document.createElement(this.mediaStreamTrack.kind === 'video' ? 'video' : 'audio');
  }
}

/**
 * A locally captured track, optionally attached to an `RTCRtpSender`.
 *
 * The sender is set after publishing, not at construction: a track can be
 * captured for a preview and published later (`client.createCameraTrack()`
 * then `room.publish(track)`), and mute has to work in both states.
 */
export class NativeLocalTrackDelegate extends NativeTrackDelegate implements LocalTrackDelegate {
  private sender?: RTCRtpSender;
  private muted = false;

  get isMuted(): boolean {
    return this.muted;
  }

  /** @internal called by the adapter once the track is attached to a sender. */
  setSender(sender: RTCRtpSender | undefined): void {
    this.sender = sender;
  }

  /**
   * Mutes by disabling the underlying track rather than removing it.
   *
   * `track.enabled = false` makes the browser send silence or black
   * frames — the RTP stream continues, the transceiver stays, and
   * unmuting is instant. Stopping the track instead would release the
   * device (turning off the camera light, which users read as "off") but
   * would then need a fresh `getUserMedia` and a renegotiation to undo.
   *
   * The SFU is told separately, via signaling, so it can stop forwarding
   * the silence to every subscriber instead of paying to relay it.
   */
  async mute(): Promise<unknown> {
    this.mediaStreamTrack.enabled = false;
    this.muted = true;
    return undefined;
  }

  async unmute(): Promise<unknown> {
    this.mediaStreamTrack.enabled = true;
    this.muted = false;
    return undefined;
  }

  /**
   * Replaces the outgoing track without renegotiating.
   *
   * This is what makes Raven Effects work mid-call: `RTCRtpSender.replaceTrack`
   * swaps the source of an established stream, so a processed video track
   * takes over from the raw camera with no offer/answer and no
   * interruption to anyone else in the room.
   */
  async replaceTrack(track: MediaStreamTrack, _userProvidedTrack?: boolean): Promise<unknown> {
    if (this.sender) {
      await this.sender.replaceTrack(track);
    }
    // Applied whether or not there is a sender, so an unpublished track's
    // preview also follows the swap.
    this.swapMediaStreamTrack(track);
    if (this.muted) {
      track.enabled = false;
    }
    return undefined;
  }

  /**
   * Send-side stats for this track.
   *
   * Returns an array for video, because a simulcast sender reports one
   * `outbound-rtp` per encoding layer — `LocalTrack.getStats()` picks the
   * highest-resolution one. `undefined` when there is no sender yet: an
   * unpublished track has no send statistics, and reporting zeroes would
   * claim it was sending nothing rather than not sending at all.
   */
  async getSenderStats(): Promise<RawTrackStats | RawTrackStats[] | undefined> {
    if (!this.sender) {
      return undefined;
    }
    const report = await this.sender.getStats();
    const samples = rawStatsFromReport(report, 'outbound-rtp');
    if (samples.length === 0) {
      return undefined;
    }
    return samples.length === 1 ? samples[0] : samples;
  }
}

/**
 * A track received from a remote participant.
 *
 * `isMuted` reflects the *publisher's* mute, which the SFU reports over
 * signaling — not `mediaStreamTrack.muted`, which in a browser means
 * "no data is arriving right now" and flickers true during ordinary
 * network jitter. A UI driven by that would flash a muted badge on a
 * perfectly healthy connection.
 */
export class NativeRemoteTrackDelegate extends NativeTrackDelegate implements RemoteTrackDelegate {
  private readonly receiver: RTCRtpReceiver;
  private publisherMuted = false;

  constructor(mediaStreamTrack: MediaStreamTrack, receiver: RTCRtpReceiver) {
    super(mediaStreamTrack);
    this.receiver = receiver;
  }

  get isMuted(): boolean {
    return this.publisherMuted;
  }

  /** @internal set from the SFU's `track.muted` / `track.unmuted` events. */
  setPublisherMuted(muted: boolean): void {
    this.publisherMuted = muted;
  }

  async getReceiverStats(): Promise<RawTrackStats | undefined> {
    const report = await this.receiver.getStats();
    const [sample] = rawStatsFromReport(report, 'inbound-rtp');
    return sample;
  }
}
