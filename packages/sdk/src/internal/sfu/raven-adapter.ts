import { RTCError } from '../../errors';
import { TypedEventEmitter } from '../../events';
import type { Logger } from '../../logger';
import { LocalParticipant, RemoteParticipant } from '../../participant';
import { LocalTrack, RemoteTrack, type TrackKind } from '../../track';
import {
  createCameraTrack,
  createMicrophoneTrack,
  createScreenShareTrack,
} from '../media/capture';
import { NativeLocalTrackDelegate, NativeRemoteTrackDelegate } from '../media/native-track';
import { listDevices } from '../devices/enumerate';
import { connectionRoundTripTimeMs } from '../telemetry/rtc-stats';
import {
  ClientMessageType,
  ServerMessageType,
  type ServerMessage,
  type ServerTrack,
} from '../signaling/protocol';
import { SignalingClient, type JoinedPayload } from '../signaling/signaling-client';
import type {
  ConnectionQuality,
  DeviceInfo,
  DeviceKind,
  SFUAdapter,
  SFUAdapterEventMap,
  SdkConnectionState,
} from './types';

/**
 * Data channel label. Has to match the SFU's `dataChannelLabel`. A channel
 * the node doesn't recognise gets closed, not quietly ignored.
 */
const DATA_CHANNEL_LABEL = 'raven-data';

/**
 * Payload ceiling for `room.sendData()` (spec §18).
 *
 * SCTP happily fragments bigger messages, but a browser's send buffer is
 * finite, and anyone pushing megabytes down a data channel will stall
 * their own media. The channel shares the transport. 64 KiB is plenty for
 * what this is actually for (reactions, cursor positions, chat) and small
 * enough to fail loudly instead of quietly wrecking a call.
 */
const MAX_DATA_PAYLOAD_BYTES = 64 * 1024;

/** How long to wait for the local description to be ready before answering. */
const ICE_GATHER_HINT_MS = 0;

/** Server source string → the SDK's own track kinds. */
function trackKindFromSource(source: string, kind: 'audio' | 'video'): TrackKind {
  switch (source) {
    case 'camera':
      return 'camera';
    case 'microphone':
      return 'microphone';
    case 'screenShare':
      return 'screenShare';
    default:
      return kind === 'audio' ? 'microphone' : 'camera';
  }
}

interface SubscribedTrack {
  track: RemoteTrack;
  delegate: NativeRemoteTrackDelegate;
  participantId: string;
  trackId: string;
}

/**
 * Raven's native `SFUAdapter`: an `RTCPeerConnection` driven by Raven's own
 * signaling.
 *
 * This replaced the LiveKit adapter. `Room` and `RTCClient` were already
 * written against `SFUAdapter` and never imported livekit-client, so the
 * public API (`createRTCClient`, `room.enableCamera()`, the event names)
 * came through the swap untouched. Which is exactly why that boundary was
 * there in the first place.
 *
 * # Negotiation
 *
 * The SFU offers, we answer. That holds for publishing too: instead of
 * offering when a track is added, the adapter adds the track and lets the
 * SFU's next offer carry it. The one exception is the first publish of a
 * given kind, where no transceiver exists yet and a client-initiated offer
 * is unavoidable. The server settles the resulting glare by refusing our
 * offer with a retryable code, and `publishWithNegotiation` has another go
 * once the server's offer has been answered.
 *
 * # Track identity
 *
 * A subscribed track is identified by `(publisherId, trackId)`, pulled off
 * the SFU's `track.published` event and matched against the `MediaStream`
 * id and track id the SFU stamps on the forwarded track. `ontrack` on its
 * own won't do: it fires with a track whose id only means anything next to
 * what signaling already told us.
 */
export class RavenAdapter extends TypedEventEmitter<SFUAdapterEventMap> implements SFUAdapter {
  readonly localParticipant: LocalParticipant;
  readonly remoteParticipants = new Map<string, RemoteParticipant>();

  private readonly logger: Logger;
  private readonly autoReconnect: boolean;

  private pc?: RTCPeerConnection;
  private signaling?: SignalingClient;
  private dataChannel?: RTCDataChannel;
  private iceServers: RTCIceServer[] = [];

  private _connectionState: SdkConnectionState = 'disconnected';
  private intentionalDisconnect = false;

  /** Published tracks by kind, so `enableCamera(false)` knows what to kill. */
  private readonly published = new Map<TrackKind, { track: LocalTrack; delegate: NativeLocalTrackDelegate; sender: RTCRtpSender; trackId: string }>();

  /** Subscribed tracks by `publisherId/trackId`. */
  private readonly subscribed = new Map<string, SubscribedTrack>();

  /**
   * What the server says each participant publishes, ahead of the media
   * actually turning up. `ontrack` and `track.published` race and either
   * can win, so both paths check in here and whichever lands second
   * finishes the subscription.
   */
  private readonly announcedTracks = new Map<string, { participantId: string; track: ServerTrack }>();

  /** Tracks whose media arrived before the announcement. */
  private readonly pendingMedia = new Map<string, { stream: MediaStream; track: MediaStreamTrack; receiver: RTCRtpReceiver }>();

  /** Last ICE/peer state the SFU told us about. Diagnostics only. */
  private sfuIceState?: string;
  private sfuPeerState?: string;

  constructor(logger: Logger, autoReconnect: boolean) {
    super();
    this.logger = logger;
    this.autoReconnect = autoReconnect;
    this.localParticipant = new LocalParticipant('');
  }

  get connectionState(): SdkConnectionState {
    return this._connectionState;
  }

  /**
   * The SFU's read on this connection's health.
   *
   * Right now that's `'unknown'` unless the SFU has reported a failure.
   *
   * TODO: return a real verdict once the SFU computes one.
   *
   * Known gap, not an oversight. The old adapter passed through LiveKit's
   * server-computed verdict, which had a vantage point no client can get
   * near: the SFU sees loss and jitter on every leg of the room, not just
   * this one. Raven's SFU doesn't work out an equivalent yet. Dressing a
   * client-side guess up as a server verdict is precisely the fabricated
   * metric spec §19 rules out, so this says "unknown" until the SFU can
   * answer honestly. `room.getConnectionStats()` gives you real per-track
   * numbers in the meantime.
   */
  getConnectionQuality(): ConnectionQuality {
    if (this.sfuPeerState === 'failed' || this._connectionState === 'failed') {
      return 'lost';
    }
    return 'unknown';
  }

  /** Diagnostics the LiveKit adapter never could give us (see `Room.getDiagnostics()`). */
  getIceConnectionState(): string | undefined {
    return this.pc?.iceConnectionState;
  }

  getSignalingState(): string | undefined {
    return this.pc?.signalingState;
  }

  /** The SFU's own view. It can disagree with the local one, and that disagreement is usually the interesting bit. */
  getRemoteConnectionState(): { iceState?: string; peerState?: string } {
    return { iceState: this.sfuIceState, peerState: this.sfuPeerState };
  }

  async getConnectionRoundTripTimeMs(): Promise<number | undefined> {
    return this.pc ? connectionRoundTripTimeMs(this.pc) : undefined;
  }

  // --- Connection --------------------------------------------------------

  async connect(endpoint: string, token: string, iceServers?: RTCIceServer[]): Promise<void> {
    this.iceServers = iceServers ?? [];
    this.setConnectionState('connecting');

    const roomId = roomIdFromToken(token);

    const signaling = new SignalingClient({
      endpoint,
      token,
      roomId,
      autoReconnect: this.autoReconnect,
      logger: this.logger,
    });
    this.signaling = signaling;

    signaling.on('message', (message) => void this.handleSignalingMessage(message));
    signaling.on('reconnecting', () => {
      this.setConnectionState('reconnecting');
      // The old PeerConnection is no use to us; the server allocates a
      // fresh session on rejoin. Tear it down now instead of at rejoin
      // time, so anyone inspecting state mid-reconnect doesn't find a
      // connection that looks alive and forwards nothing.
      this.teardownPeerConnection();
    });
    signaling.on('joined', (payload) => void this.handleJoined(payload));
    signaling.on('failed', (error) => {
      this.logger.error('signaling failed', error.message);
      this.setConnectionState('failed');
    });
    signaling.on('closed', () => {
      this.setConnectionState(this.intentionalDisconnect ? 'disconnected' : 'failed');
    });

    try {
      const joined = await signaling.connect();
      this.localParticipant._setIdentity(participantIdFromToken(token));
      await this.handleJoined(joined);
    } catch (error) {
      this.setConnectionState('failed');
      throw error instanceof RTCError
        ? error
        : new RTCError('CONNECTION_FAILED', 'Could not join the room', error);
    }
  }

  /**
   * Applies whatever room state the server reported at join.
   *
   * Runs on first join and after every reconnect. On a reconnect the
   * server's participant list wins outright and the old one goes in the
   * bin: anyone who left during the outage must not linger, anyone who
   * joined during it must show up.
   */
  private async handleJoined(payload: JoinedPayload): Promise<void> {
    this.logger.debug(
      'room state at join',
      `${payload.participants.length} participant(s)`,
      payload.rtcServer ? `on ${payload.rtcServer}` : '',
    );

    // Reconcile, don't append. Leaves for anyone gone, joins for anyone
    // new, everybody else untouched, so a reconnect doesn't make every
    // tile in the UI flash.
    const present = new Set(payload.participants.map((participant) => participant.id));
    for (const [id, participant] of this.remoteParticipants) {
      if (!present.has(id)) {
        this.remoteParticipants.delete(id);
        this.emit('participantLeft', participant);
      }
    }

    for (const entry of payload.participants) {
      let participant = this.remoteParticipants.get(entry.id);
      if (!participant) {
        participant = new RemoteParticipant(entry.id);
        this.remoteParticipants.set(entry.id, participant);
        this.emit('participantJoined', participant);
      }
      for (const track of entry.tracks ?? []) {
        this.announceTrack(entry.id, track);
      }
    }
  }

  private async handleSignalingMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case ServerMessageType.ROOM_JOINED:
        // Usually the join handshake eats this, but handle it here too.
        // The server can re-send room state on an established connection,
        // and `handleJoined` reconciles, not appends, so applying it
        // again is harmless and keeps the client's view honest.
        await this.handleJoined({
          roomId: message.roomId,
          participants: message.participants,
          rtcServer: message.rtcServer,
          region: message.region,
        });
        return;

      case ServerMessageType.SDP_OFFER:
        await this.handleOffer(message.sdp);
        return;

      case ServerMessageType.SDP_ANSWER:
        await this.handleAnswer(message.sdp);
        return;

      case ServerMessageType.ICE_CANDIDATE:
        await this.handleRemoteCandidate(message);
        return;

      case ServerMessageType.PARTICIPANT_JOINED: {
        const existing = this.remoteParticipants.get(message.participant.id);
        if (existing) {
          return;
        }
        const participant = new RemoteParticipant(message.participant.id);
        this.remoteParticipants.set(participant.identity, participant);
        this.emit('participantJoined', participant);
        return;
      }

      case ServerMessageType.PARTICIPANT_LEFT: {
        const participant = this.remoteParticipants.get(message.participant.id);
        if (!participant) {
          return;
        }
        this.remoteParticipants.delete(participant.identity);
        // Their tracks leave with them. The PeerConnection fires
        // `onremovetrack` as well, but lean on that alone and the UI keeps
        // showing a departed participant's frozen last frame until the
        // browser gets round to it.
        for (const [key, subscription] of this.subscribed) {
          if (subscription.participantId === participant.identity) {
            this.subscribed.delete(key);
            this.emit('trackUnsubscribed', subscription.track, participant);
          }
        }
        this.emit('participantLeft', participant);
        return;
      }

      case ServerMessageType.TRACK_PUBLISHED:
        this.announceTrack(message.participantId, message.track);
        return;

      case ServerMessageType.TRACK_UNPUBLISHED: {
        const key = subscriptionKey(message.participantId, message.trackId);
        this.announcedTracks.delete(key);
        this.pendingMedia.delete(key);
        const subscription = this.subscribed.get(key);
        const participant = this.remoteParticipants.get(message.participantId);
        if (subscription && participant) {
          this.subscribed.delete(key);
          this.emit('trackUnpublished', subscription.track.kind, participant);
          this.emit('trackUnsubscribed', subscription.track, participant);
        }
        return;
      }

      case ServerMessageType.TRACK_MUTED:
      case ServerMessageType.TRACK_UNMUTED: {
        const muted = message.type === ServerMessageType.TRACK_MUTED;
        const key = subscriptionKey(message.participantId, message.trackId);
        const subscription = this.subscribed.get(key);
        const participant = this.remoteParticipants.get(message.participantId);
        if (!subscription || !participant) {
          return;
        }
        // The publisher's mute, not the browser's "nothing arriving" flag.
        // See NativeRemoteTrackDelegate.
        subscription.delegate.setPublisherMuted(muted);
        this.emit(muted ? 'trackMuted' : 'trackUnmuted', subscription.track.kind, participant);
        return;
      }

      case ServerMessageType.CONNECTION_STATE:
        this.sfuIceState = message.iceState;
        this.sfuPeerState = message.peerState;
        this.logger.debug('sfu connection state', message.iceState, message.peerState);
        return;

      case ServerMessageType.ERROR:
        // The signaling client handles fatal codes by closing. Whatever
        // reaches here is retryable, glare most of all, which the publish
        // path deals with.
        if (message.code === 'NEGOTIATION_GLARE') {
          this.logger.debug('publish deferred by glare; will retry after the next offer');
          return;
        }
        this.emit('mediaError', new Error(message.message));
        return;

      default:
        return;
    }
  }

  // --- Negotiation -------------------------------------------------------

  private ensurePeerConnection(): RTCPeerConnection {
    if (this.pc) {
      return this.pc;
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        // End of gathering. We don't forward it. The server reads "no more
        // candidates" the same way, and an explicit end-of-candidates
        // message is one more thing three client implementations would
        // have to agree on.
        return;
      }
      this.signaling?.send({
        type: ClientMessageType.ICE_CANDIDATE,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? undefined,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
        usernameFragment: event.candidate.usernameFragment ?? undefined,
      });
    };

    pc.onconnectionstatechange = () => {
      this.logger.debug('peer connection state', pc.connectionState);
      switch (pc.connectionState) {
        case 'connected':
          this.setConnectionState('connected');
          break;
        case 'failed':
          // Whether to reconnect is the signaling client's call. Say
          // 'reconnecting' when it won't and we've lied; say 'failed' when
          // it will and we're merely early, which the next state change
          // sorts out.
          this.setConnectionState(this.autoReconnect ? 'reconnecting' : 'failed');
          break;
        case 'disconnected':
          // Transient by definition in WebRTC; ICE may well sort itself
          // out. Not surfaced as a state change, because a UI flashing
          // "reconnecting" at every little blip is worse than one that
          // holds its nerve.
          break;
        default:
          break;
      }
    };

    pc.ontrack = (event) => this.handleIncomingTrack(event);

    pc.ondatachannel = (event) => {
      if (event.channel.label !== DATA_CHANNEL_LABEL) {
        return;
      }
      this.attachDataChannel(event.channel);
    };

    return pc;
  }

  private async handleOffer(sdp: string): Promise<void> {
    const pc = this.ensurePeerConnection();
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Send `pc.localDescription`, not `answer`. The browser may have
      // stuffed candidates into it since, and the pre-set copy would lose
      // them.
      this.signaling?.send({
        type: ClientMessageType.SDP_ANSWER,
        sdp: pc.localDescription?.sdp ?? answer.sdp ?? '',
      });

      // Anything publishing had to defer because of glare can go ahead
      // now the server's offer is answered.
      this.flushDeferredPublishes();
    } catch (error) {
      this.logger.error('failed to answer offer', (error as Error).message);
      this.emit('mediaError', new Error('Could not answer the server\'s offer'));
    }
  }

  private async handleAnswer(sdp: string): Promise<void> {
    if (!this.pc) {
      return;
    }
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      this.logger.error('failed to apply answer', (error as Error).message);
    }
  }

  private async handleRemoteCandidate(message: {
    candidate: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
    usernameFragment?: string;
  }): Promise<void> {
    if (!this.pc) {
      return;
    }
    try {
      await this.pc.addIceCandidate({
        candidate: message.candidate,
        sdpMid: message.sdpMid,
        sdpMLineIndex: message.sdpMLineIndex,
        usernameFragment: message.usernameFragment,
      });
    } catch (error) {
      // Candidates turn up just before a remote description gets set, or
      // for a transceiver that's already gone, all the time. Neither is
      // worth surfacing; the connection comes up on the candidates that do
      // apply.
      this.logger.debug('ignoring ICE candidate', (error as Error).message);
    }
  }

  /** Publishes that glare pushed back, retried once we've answered the server. */
  private deferredPublishes: (() => void)[] = [];

  private flushDeferredPublishes(): void {
    const pending = this.deferredPublishes;
    this.deferredPublishes = [];
    for (const retry of pending) {
      retry();
    }
  }

  /**
   * Offers, so the server hears about a track we just added.
   *
   * Only needed when adding the track created a new transceiver, which is
   * the first publish of each kind. Later publishes of the same kind reuse
   * the transceiver and hitch a ride on the server's next offer.
   */
  private async negotiatePublish(): Promise<void> {
    const pc = this.pc;
    const signaling = this.signaling;
    if (!pc || !signaling) {
      return;
    }

    if (pc.signalingState !== 'stable') {
      // Server already has an offer in flight. Answer that first and
      // retry, instead of putting a competing offer on the wire.
      this.logger.debug('deferring publish negotiation until stable');
      this.deferredPublishes.push(() => void this.negotiatePublish());
      return;
    }

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitTick();
      signaling.send({
        type: ClientMessageType.SDP_OFFER,
        sdp: pc.localDescription?.sdp ?? offer.sdp ?? '',
      });
    } catch (error) {
      this.logger.error('publish negotiation failed', (error as Error).message);
      throw new RTCError('MEDIA_ERROR', 'Could not negotiate the published track', error);
    }
  }

  // --- Incoming media ----------------------------------------------------

  /**
   * Matches an arriving track up with whatever signaling said about it.
   *
   * The SFU forwards every subscription carrying the *publisher's* track id
   * as the SDP `msid` track id, and that's what makes attribution possible
   * without a side channel. `ontrack` and `track.published` race, so this
   * only completes a subscription when both halves are in, parking
   * whichever showed up first.
   *
   * # Why the id comes from the SDP, not the track
   *
   * `RTCTrackEvent.track.id` is **not** the remote track id. Chrome mints
   * a brand-new local id for a received track and pays no attention to the
   * `msid`; the id in `a=msid:<stream> <track>` is the remote one. So
   * matching on `event.track.id` never matched anything, ever. And because
   * the unmatched track got parked as "media arrived early", it failed in
   * total silence: a subscription that simply never completed, not an
   * error anybody could see. Reading the `msid` is the standards-defined
   * way to get the id the remote peer actually picked.
   */
  private handleIncomingTrack(event: RTCTrackEvent): void {
    const [stream] = event.streams;
    // In order of preference: the msid track id, which is what the SFU
    // actually labelled this with, then the local track id, for any stack
    // that does adopt the msid.
    const trackId = this.remoteTrackIdFor(event) ?? event.track.id;

    // Whichever announcement mentions this track id names the publisher.
    // The SFU guarantees track ids are unique inside a room, since they
    // come from separate publishers' own tracks.
    const announcement = this.findAnnouncementForTrack(trackId);

    if (!announcement) {
      // Log what *was* announced. Nine times out of ten a subscription
      // that never completes is an id mismatch, not a real ordering race,
      // and without this line the two look identical.
      this.logger.debug(
        'media arrived before its announcement',
        `resolved=${trackId}`,
        `local=${event.track.id}`,
        `stream=${stream?.id ?? 'none'}`,
        `mid=${event.transceiver?.mid ?? 'none'}`,
        `announced=[${Array.from(this.announcedTracks.values())
          .map((entry) => `${entry.participantId}:${entry.track.trackId}`)
          .join(', ')}]`,
      );
      this.pendingMedia.set(pendingKey(trackId), {
        stream: stream ?? new MediaStream([event.track]),
        track: event.track,
        receiver: event.receiver,
      });
      return;
    }

    this.completeSubscription(
      announcement.participantId,
      announcement.track,
      event.track,
      event.receiver,
    );
  }

  /**
   * The remote track id for an arriving track, read out of the remote SDP.
   *
   * Found via the transceiver's `mid` rather than by scanning every
   * `a=msid:` line. Someone publishing both a camera and a screen share
   * has two video m-sections, and picking the wrong one labels a screen
   * share as somebody's face.
   *
   * Returns undefined when the SDP doesn't say, either an `msid`-less
   * offer or a transceiver with no mid yet, so the caller can fall back
   * instead of guessing.
   */
  private remoteTrackIdFor(event: RTCTrackEvent): string | undefined {
    const mid = event.transceiver?.mid;
    const sdp = this.pc?.remoteDescription?.sdp;
    if (!mid || !sdp) {
      return undefined;
    }

    // First chunk is the session section and has no m= line. Everything
    // after it is one media description.
    const sections = sdp.split(/\r?\nm=/).slice(1);
    for (const section of sections) {
      const lines = section.split(/\r?\n/);
      if (!lines.some((line) => line.trim() === `a=mid:${mid}`)) {
        continue;
      }
      const msid = lines.find((line) => line.startsWith('a=msid:'));
      // `a=msid:<stream-id> <track-id>`. The stream-only form is legal
      // and has no track id in it to hand back.
      const trackId = msid?.slice('a=msid:'.length).trim().split(/\s+/)[1];
      return trackId && trackId.length > 0 ? trackId : undefined;
    }
    return undefined;
  }

  private findAnnouncementForTrack(
    trackId: string,
  ): { participantId: string; track: ServerTrack } | undefined {
    for (const announcement of this.announcedTracks.values()) {
      if (announcement.track.trackId === trackId) {
        return announcement;
      }
    }
    return undefined;
  }

  private announceTrack(participantId: string, track: ServerTrack): void {
    const key = subscriptionKey(participantId, track.trackId);
    this.announcedTracks.set(key, { participantId, track });
    this.logger.debug('track announced', `${participantId}:${track.trackId}`, track.kind, track.source);

    const participant = this.remoteParticipants.get(participantId);
    if (participant) {
      this.emit('trackPublished', trackKindFromSource(track.source, track.kind), participant);
    }

    // Media might already have beaten us here.
    const pending = this.pendingMedia.get(pendingKey(track.trackId));
    if (pending) {
      this.pendingMedia.delete(pendingKey(track.trackId));
      this.completeSubscription(participantId, track, pending.track, pending.receiver);
    }
  }

  private completeSubscription(
    participantId: string,
    serverTrack: ServerTrack,
    mediaStreamTrack: MediaStreamTrack,
    receiver: RTCRtpReceiver,
  ): void {
    const participant = this.remoteParticipants.get(participantId);
    if (!participant) {
      this.logger.debug('track for an unknown participant', participantId);
      return;
    }

    const key = subscriptionKey(participantId, serverTrack.trackId);
    if (this.subscribed.has(key)) {
      return;
    }

    const delegate = new NativeRemoteTrackDelegate(mediaStreamTrack, receiver);
    delegate.setPublisherMuted(serverTrack.muted);
    const kind = trackKindFromSource(serverTrack.source, serverTrack.kind);
    const track = new RemoteTrack(delegate, kind);

    this.subscribed.set(key, { track, delegate, participantId, trackId: serverTrack.trackId });
    participant.tracks.push(track);
    this.emit('trackSubscribed', track, participant);

    mediaStreamTrack.onended = () => {
      const subscription = this.subscribed.get(key);
      if (!subscription) {
        return;
      }
      this.subscribed.delete(key);
      const index = participant.tracks.indexOf(subscription.track);
      if (index !== -1) {
        participant.tracks.splice(index, 1);
      }
      this.emit('trackUnsubscribed', subscription.track, participant);
    };
  }

  // --- Publishing --------------------------------------------------------

  async enableCamera(enabled: boolean): Promise<LocalTrack | undefined> {
    return enabled
      ? this.publishKind('camera', () => createCameraTrack())
      : this.unpublishKind('camera');
  }

  async enableMicrophone(enabled: boolean): Promise<LocalTrack | undefined> {
    return enabled
      ? this.publishKind('microphone', () => createMicrophoneTrack())
      : this.unpublishKind('microphone');
  }

  async enableScreenShare(enabled: boolean): Promise<LocalTrack | undefined> {
    return enabled
      ? this.publishKind('screenShare', () => createScreenShareTrack())
      : this.unpublishKind('screenShare');
  }

  private async publishKind(
    kind: TrackKind,
    capture: () => Promise<LocalTrack>,
  ): Promise<LocalTrack | undefined> {
    const existing = this.published.get(kind);
    if (existing) {
      // Already publishing, so unmute instead of capturing again. A
      // second getUserMedia on the same device is slower and on some
      // platforms just fails.
      await existing.track.unmute();
      this.signaling?.send({
        type: ClientMessageType.TRACK_MUTE,
        trackId: existing.trackId,
        muted: false,
      });
      return existing.track;
    }

    const track = await capture();
    await this.publish(track);
    return track;
  }

  private async unpublishKind(kind: TrackKind): Promise<undefined> {
    const existing = this.published.get(kind);
    if (!existing) {
      return undefined;
    }
    await this.unpublish(existing.track);
    return undefined;
  }

  async publish(track: LocalTrack): Promise<void> {
    const pc = this.ensurePeerConnection();
    const delegate = track['delegate'] as unknown;
    if (!(delegate instanceof NativeLocalTrackDelegate)) {
      throw new RTCError(
        'MEDIA_ERROR',
        'This track was not created by the Raven SDK and cannot be published',
      );
    }

    const stream =
      typeof MediaStream !== 'undefined'
        ? new MediaStream([track.mediaStreamTrack])
        : undefined;

    let sender: RTCRtpSender;
    try {
      sender = stream
        ? pc.addTrack(track.mediaStreamTrack, stream)
        : pc.addTrack(track.mediaStreamTrack);
    } catch (error) {
      throw new RTCError('MEDIA_ERROR', 'Could not add the track to the connection', error);
    }

    // Declared over signaling, never inferred from the SDP. A page can't
    // pick the stream or track id the SDP carries, since both are
    // read-only, which leaves codec kind as all the SFU would have to go
    // on. And that can't tell a screen share from a camera (spec §16).
    // Sent before negotiating, so the source is known by the time the
    // track lands on the node.
    const source = declaredSourceFor(track.kind);
    if (source) {
      this.signaling?.send({
        type: ClientMessageType.TRACK_PUBLISH,
        trackId: track.mediaStreamTrack.id,
        source,
      });
    }

    delegate.setSender(sender);
    await this.applySimulcast(sender, track.kind);

    this.published.set(track.kind, {
      track,
      delegate,
      sender,
      trackId: track.mediaStreamTrack.id,
    });
    if (!this.localParticipant.tracks.includes(track)) {
      this.localParticipant.tracks.push(track);
    }

    // A screen share the user stops from the browser's own bar ends the
    // track without telling us. Unpublishing here keeps the room's view
    // correct without the application having to watch for it.
    track.mediaStreamTrack.onended = () => {
      void this.unpublish(track).catch(() => undefined);
    };

    await this.negotiatePublish();
    this.emit('localTrackPublished', track);
  }

  async unpublish(track: LocalTrack): Promise<void> {
    const entry = this.published.get(track.kind);
    if (!entry || entry.track !== track) {
      return;
    }

    this.published.delete(track.kind);
    const index = this.localParticipant.tracks.indexOf(track);
    if (index !== -1) {
      this.localParticipant.tracks.splice(index, 1);
    }

    entry.delegate.setSender(undefined);
    try {
      this.pc?.removeTrack(entry.sender);
    } catch (error) {
      this.logger.debug('removeTrack failed', (error as Error).message);
    }
    track.mediaStreamTrack.stop();

    await this.negotiatePublish();
    this.emit('localTrackUnpublished', track);
  }

  /**
   * Sets up simulcast on a video sender (spec §15).
   *
   * Three spatial layers, each a quarter of the previous one's pixel count.
   * That's the standard ladder and the one browsers actually implement
   * well. Applied with `setParameters` after `addTrack` instead of through
   * `addTransceiver`'s `sendEncodings`, because the transceiver may already
   * exist from the SFU's offer and re-adding it would renegotiate for
   * nothing at all.
   *
   * Audio gets left alone. There's no spatial layering to do, and Opus
   * already sorts its own bitrate out.
   */
  private async applySimulcast(sender: RTCRtpSender, kind: TrackKind): Promise<void> {
    if (kind === 'microphone' || sender.track?.kind !== 'video') {
      return;
    }
    // Screen shares don't simulcast, on purpose. The content is usually
    // text, and dropping resolution wrecks legibility in a way it never
    // does for a face. One high-quality layer is the better trade.
    if (kind === 'screenShare') {
      return;
    }

    try {
      const parameters = sender.getParameters();
      // Some browsers report no encodings at all until the first
      // negotiation completes, and setting them then just fails. The SFU
      // falls back to a single layer, which is fine, not broken.
      if (!parameters.encodings || parameters.encodings.length === 0) {
        return;
      }

      parameters.encodings = [
        { rid: 'low', scaleResolutionDownBy: 4, maxBitrate: 150_000 },
        { rid: 'medium', scaleResolutionDownBy: 2, maxBitrate: 500_000 },
        { rid: 'high', scaleResolutionDownBy: 1, maxBitrate: 1_500_000 },
      ];
      await sender.setParameters(parameters);
    } catch (error) {
      // Not fatal. A publisher without simulcast still publishes, and
      // every subscriber gets the one layer.
      this.logger.debug('simulcast not applied', (error as Error).message);
    }
  }

  // --- Data channel ------------------------------------------------------

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (event: MessageEvent) => {
      const payload = toUint8Array(event.data);
      if (payload) {
        // No participant attribution here. The SFU fans data out over
        // each recipient's own channel, so the transport carries no sender
        // identity at all. Attributing it would mean trusting a field the
        // sender controls, and saying nothing beats that.
        this.emit('dataReceived', payload, undefined);
      }
    };
    channel.onclose = () => {
      if (this.dataChannel === channel) {
        this.dataChannel = undefined;
      }
    };
  }

  async sendData(payload: Uint8Array<ArrayBuffer>): Promise<void> {
    if (payload.byteLength > MAX_DATA_PAYLOAD_BYTES) {
      throw new RTCError(
        'MEDIA_ERROR',
        `Data payload is ${payload.byteLength} bytes, over the ${MAX_DATA_PAYLOAD_BYTES}-byte limit`,
      );
    }

    const channel = this.dataChannel ?? this.openDataChannel();
    if (!channel) {
      throw new RTCError('CONNECTION_FAILED', 'sendData() requires an active connection');
    }
    if (channel.readyState !== 'open') {
      throw new RTCError('CONNECTION_FAILED', 'The data channel is not open yet');
    }

    try {
      channel.send(payload);
    } catch (error) {
      throw new RTCError('PERMISSION_DENIED', 'Could not send data; check the token grants publishData', error);
    }
  }

  /**
   * Opens the data channel when something actually wants it.
   *
   * Not at connect time. A channel costs an SCTP association and most
   * calls never send a byte of data. The client creates it, not the
   * server, because the client is the side that knows it needs one.
   */
  private openDataChannel(): RTCDataChannel | undefined {
    if (!this.pc) {
      return undefined;
    }
    // Ordered and reliable. That's the default, and what anyone sending
    // structured messages expects. Unreliable delivery would suit
    // high-frequency cursor updates, but as an opt-in later, not as a
    // default that surprises everybody else.
    const channel = this.pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.attachDataChannel(channel);
    return channel;
  }

  // --- Devices -----------------------------------------------------------

  async getDevices(kind?: DeviceKind): Promise<DeviceInfo[]> {
    return listDevices(kind);
  }

  async setDevice(kind: DeviceKind, deviceId: string): Promise<void> {
    switch (kind) {
      case 'videoinput':
        return this.replaceDevice('camera', () => createCameraTrack({ deviceId }));
      case 'audioinput':
        return this.replaceDevice('microphone', () => createMicrophoneTrack({ deviceId }));
      case 'audiooutput':
        return this.setAudioOutput(deviceId);
      default:
        throw new RTCError('DEVICE_NOT_FOUND', `Unknown device kind "${String(kind)}"`);
    }
  }

  /**
   * Swaps the device behind a published track without renegotiating.
   *
   * `replaceTrack` is what makes it seamless. Transceiver, SSRC, and every
   * subscriber's view of the track all stay put, so nobody else in the
   * room notices a thing.
   */
  private async replaceDevice(kind: TrackKind, capture: () => Promise<LocalTrack>): Promise<void> {
    const entry = this.published.get(kind);
    if (!entry) {
      // Nothing published, so nothing to switch. Capturing and publishing
      // here would turn a device preference into a publish nobody asked
      // for.
      return;
    }

    const replacement = await capture();
    const previous = entry.track.mediaStreamTrack;
    await entry.delegate.replaceTrack(replacement.mediaStreamTrack);
    previous.stop();
  }

  /**
   * Points this room's remote audio at a different output device.
   *
   * `setSinkId` works per element, so this walks whatever elements each
   * remote audio track is attached to. Safari doesn't have `setSinkId` at
   * all. `Room.setSpeakerDevice()` checks and throws before we get here,
   * so an unsupported browser gets a real error instead of a silent no-op.
   */
  private async setAudioOutput(deviceId: string): Promise<void> {
    const failures: unknown[] = [];

    for (const subscription of this.subscribed.values()) {
      if (subscription.track.kind === 'camera' || subscription.track.kind === 'screenShare') {
        continue;
      }
      for (const element of subscription.track.detach()) {
        const withSink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
        try {
          await withSink.setSinkId?.(deviceId);
        } catch (error) {
          failures.push(error);
        }
        subscription.track.attach(element);
      }
    }

    if (failures.length > 0) {
      throw new RTCError('DEVICE_NOT_FOUND', 'Could not switch the audio output device', failures[0]);
    }
  }

  // --- Teardown ----------------------------------------------------------

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;

    for (const entry of this.published.values()) {
      entry.track.mediaStreamTrack.stop();
    }
    this.published.clear();
    this.localParticipant.tracks.length = 0;

    this.signaling?.close();
    this.teardownPeerConnection();

    this.remoteParticipants.clear();
    this.subscribed.clear();
    this.announcedTracks.clear();
    this.pendingMedia.clear();

    this.setConnectionState('disconnected');
  }

  private teardownPeerConnection(): void {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
        // Went with the connection already.
      }
      this.dataChannel = undefined;
    }
    if (!this.pc) {
      return;
    }
    // Clear the handlers before closing, so a state change fired during
    // teardown doesn't get mistaken for a connection failure.
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.ontrack = null;
    this.pc.ondatachannel = null;
    try {
      this.pc.close();
    } catch {
      // Already closed.
    }
    this.pc = undefined;
  }

  private setConnectionState(state: SdkConnectionState): void {
    if (this._connectionState === state) {
      return;
    }
    this._connectionState = state;
    this.emit('connectionStateChanged', state);
  }
}

function subscriptionKey(participantId: string, trackId: string): string {
  return `${participantId}/${trackId}`;
}

function pendingKey(trackId: string): string {
  return `media:${trackId}`;
}

/** SDK track kinds → the source names the wire protocol uses. */
function declaredSourceFor(kind: TrackKind): 'camera' | 'microphone' | 'screenShare' | undefined {
  switch (kind) {
    case 'camera':
    case 'microphone':
    case 'screenShare':
      return kind;
    default:
      return undefined;
  }
}

/**
 * Turns whatever a data channel handed us into bytes.
 *
 * Uses `Object.prototype.toString` instead of `instanceof`, because
 * `instanceof ArrayBuffer` comes back false for a buffer that crossed a
 * realm boundary. That's not a test-environment curiosity either: Web
 * Workers, iframes and a few bundler shims each bring their own
 * `ArrayBuffer`. An `instanceof` check in that situation silently drops
 * every single message.
 */
function toUint8Array(data: unknown): Uint8Array | undefined {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (ArrayBuffer.isView(data)) {
    // Respect the view's offset and length. A Uint8Array covering part of
    // a bigger buffer must not be read as the whole thing.
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (isArrayBufferLike(data)) {
    return new Uint8Array(data);
  }
  return undefined;
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
}

/** Yields once, giving a just-set local description a beat to settle before we read it. */
function waitTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ICE_GATHER_HINT_MS));
}

/**
 * Reads which room this token was minted for.
 *
 * The token is a Raven JWT and its payload is readable, not secret. Same
 * information the server is going to act on. We decode it; we never trust
 * it. The server re-verifies the signature, and anything a client fiddles
 * with here only changes which room it *asks* for.
 */
function roomIdFromToken(token: string): string {
  const claims = decodeClaims(token);
  const roomId = claims?.rid;
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new RTCError('INVALID_TOKEN', 'RTC token does not name a room');
  }
  return roomId;
}

function participantIdFromToken(token: string): string {
  const claims = decodeClaims(token);
  return typeof claims?.sub === 'string' ? claims.sub : '';
}

function decodeClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
