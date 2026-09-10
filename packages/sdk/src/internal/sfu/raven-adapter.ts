import { RTCError } from '../../errors';
import { TypedEventEmitter } from '../../events';
import type { Logger } from '../../logger';
import { LocalParticipant, RemoteParticipant } from '../../participant';
import { LocalTrack, RemoteTrack, type TrackKind } from '../../track';
import { createCameraTrack, createMicrophoneTrack, createScreenShareTrack } from '../media/capture';
import { NativeLocalTrackDelegate, NativeRemoteTrackDelegate } from '../media/native-track';
import { listDevices } from '../devices/enumerate';
import { connectionRoundTripTimeMs } from '../telemetry/rtc-stats';
import { ClientMessageType, ServerMessageType, type ServerMessage, type ServerTrack } from '../signaling/protocol';
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
 * Livqeno's native `SFUAdapter`: an `RTCPeerConnection` driven by Livqeno's own
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
 * Both peers offer on one PeerConnection: the SFU offers at join and for
 * every subscription, and this adapter offers when a local track needs an
 * m-section that does not exist yet (the first publish of each kind).
 *
 * Every operation that touches the signaling state machine therefore goes
 * through one chain — `enqueue()` — and nothing else is allowed near
 * `setLocalDescription` / `setRemoteDescription`. Checking
 * `signalingState` and *then* awaiting `createOffer()` is not enough and
 * was the bug this replaced: the check passes, the await yields, the SFU's
 * offer lands in that gap, and `setLocalDescription` throws "Called in
 * wrong state: have-remote-offer". The track keeps its sender, the
 * m-section stays `recvonly`, and the room sees no media while the SDK
 * reports a successful publish.
 *
 * Local changes never offer directly. Adding a track or creating a data
 * channel sets the browser's own negotiation-needed bit; its
 * `negotiationneeded` event queues one offer task, and however many
 * changes are pending collapse into that single offer — or into none, if a
 * round is already in flight, in which case the end of that round looks
 * again. So publishing a microphone and a camera back to back never races,
 * and no timers are involved anywhere.
 *
 * The browser's bit is the source of truth on purpose. It clears when some
 * description covers the change — including one the *SFU* offered — which
 * an SDK-side "something changed" flag cannot know. An earlier version of
 * this kept its own flag and re-offered until answered; against a real SFU
 * that produced 48 rounds of offer/rollback on a single join, until the
 * connection's message rate limit tripped.
 *
 * Glare — both sides offering at once — resolves politely: the SFU's offer
 * wins, ours rolls back and is re-queued. The SFU independently refuses a
 * client offer mid-round with a retryable `NEGOTIATION_GLARE`, which lands
 * in the same re-queue.
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

  /**
   * What this participant *wants* published, by kind.
   *
   * Desired state, deliberately not PeerConnection state. A reconnect
   * throws the PeerConnection away and with it every `RTCRtpSender`, but
   * the camera is still on and the developer never asked for it to stop —
   * so `sender` is the only field here that a replacement connection
   * invalidates, and `restoreLocalPublications()` refills it. Before this
   * split, a reconnect left the map holding senders belonging to a closed
   * connection: the tracks looked published, the new connection had no
   * transceivers for them, and the room went quiet.
   */
  private readonly published = new Map<
    TrackKind,
    { track: LocalTrack; delegate: NativeLocalTrackDelegate; sender?: RTCRtpSender; trackId: string }
  >();

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
  private readonly pendingMedia = new Map<
    string,
    { stream: MediaStream; track: MediaStreamTrack; receiver: RTCRtpReceiver }
  >();

  /** Last ICE/peer state the SFU told us about. Diagnostics only. */
  private sfuIceState?: string;
  private sfuPeerState?: string;

  /**
   * Serializes everything that touches the signaling state machine —
   * remote offers, remote answers, our own offers, remote candidates.
   * See `enqueue()`.
   */
  private negotiationChain: Promise<void> = Promise.resolve();

  /** A local change is waiting for an offer to carry it. */
  private negotiationNeeded = false;

  /** An offer task is already on the chain, so more requests coalesce into it. */
  private negotiationScheduled = false;

  /** Callers of `dataChannelOpened()`, settled when the channel opens. */
  private dataChannelWaiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];

  /** In-flight enable/disable per track kind. See `withKindLock()`. */
  private readonly kindOperations = new Map<TrackKind, Promise<void>>();

  /**
   * Whether this page has asked for a data channel.
   *
   * Desired state, like `published`: the channel itself belongs to a
   * PeerConnection and does not survive a reconnect, but the intent does.
   */
  private dataChannelWanted = false;

  /** Payloads accepted while the channel was still opening. */
  private dataQueue: Uint8Array[] = [];

  /**
   * Track ids we have already offered once to get onto the wire.
   *
   * `publishedTracksMissingFromSdp()` asks for one corrective offer per
   * published track and then stops asking, whatever the outcome. A
   * standing condition instead of a one-shot is a treadmill: if the
   * browser will not put our id in the description — a reused transceiver
   * whose msid it considers settled — then re-checking after every round
   * trip re-offers forever. Bounding it costs a mislabelled track source
   * in that corner; not bounding it costs the connection.
   */
  private readonly msidRefreshAttempted = new Set<string>();

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
   * this one. Livqeno's SFU doesn't work out an equivalent yet. Dressing a
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
      this.abortDataChannelWaiters('The connection failed before the data channel could open');
      this.setConnectionState('failed');
    });
    signaling.on('closed', () => {
      this.abortDataChannelWaiters('The connection closed before the data channel could open');
      this.setConnectionState(this.intentionalDisconnect ? 'disconnected' : 'failed');
    });

    try {
      const joined = await signaling.connect();
      this.localParticipant._setIdentity(participantIdFromToken(token));
      await this.handleJoined(joined);
    } catch (error) {
      this.setConnectionState('failed');
      throw error instanceof RTCError ? error : new RTCError('CONNECTION_FAILED', 'Could not join the room', error);
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

    // A rejoin is a new SFU session with a new PeerConnection, so
    // everything local has to be put back on it. No-op on a first join
    // (nothing published yet) and idempotent on a re-sent room state.
    this.restoreLocalPublications();

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
        // Queued, not awaited inline. `handleSignalingMessage` is invoked
        // per socket frame with no ordering guarantee of its own, so two
        // offers arriving together would otherwise interleave their
        // `setRemoteDescription` calls.
        await this.enqueue(() => this.applyRemoteOffer(message.sdp));
        return;

      case ServerMessageType.SDP_ANSWER:
        await this.enqueue(() => this.applyRemoteAnswer(message.sdp));
        return;

      case ServerMessageType.ICE_CANDIDATE:
        // On the chain as well, so a candidate can never be applied
        // between a remote description being set and the answer being
        // built, which is where "unknown mid" rejections come from.
        await this.enqueue(() => this.applyRemoteCandidate(message));
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
          // The SFU was mid-round and refused our offer. Ask again: the
          // request survives, which it did not before — the old code
          // logged this and dropped the publish, leaving a sender with no
          // m-section to send on.
          // "answer it, then retry", says the SFU. There is nothing to do
          // here: its offer is on the way, applying it rolls ours back,
          // and the browser then tells us whether a retry is warranted.
          this.logger.debug('sfu refused our offer as glare; waiting for its offer');
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

    // The browser's own negotiation-needed bit, which is the only accurate
    // account of whether a local change still needs an offer.
    //
    // An earlier version of this kept its own "something changed" flag and
    // re-offered until an answer came back. That loops: the SFU's own
    // offers routinely cover our new senders, so the flag stayed set with
    // nothing left to negotiate, and each retry collided with the next SFU
    // offer — 48 rounds of offer/rollback in one join, until the
    // connection's message rate limit tripped. `negotiationneeded` fires
    // only while the current local description really is missing
    // something, and the browser clears it — including after a rollback —
    // so the loop cannot form.
    pc.onnegotiationneeded = () => {
      this.logger.debug('browser reports negotiation needed');
      this.negotiationNeeded = true;
      this.scheduleNegotiation();
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

  /**
   * Runs `task` after everything already queued, and before anything
   * queued later.
   *
   * The only way to touch this PeerConnection's signaling state. A failing
   * task must not wedge the chain, so the next one runs either way — the
   * caller still sees the rejection through the promise it holds.
   *
   * Nothing on this chain ever waits for the *peer*: each task does its
   * local half (apply a description, build an answer, send an offer) and
   * returns. Waiting for a reply while holding the chain would deadlock,
   * since the reply itself has to come through here.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.negotiationChain.then(task, task);
    this.negotiationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Records that something local needs an offer, and makes sure exactly
   * one offer task is queued to carry it.
   *
   * Synchronous and non-throwing on purpose: publishing a track should not
   * fail because the connection happens to be mid-round. The request is
   * durable — it outlives an in-flight round, a glare rejection and a
   * reconnect — and is cleared only once an offer for it is actually on
   * the wire.
   */
  /**
   * Nudges the chain to look for work.
   *
   * Does not decide that an offer is needed — `negotiationneeded` does
   * that. Used where a round has just ended, or where a local change has
   * been made and the browser's event may already have fired.
   */
  private scheduleNegotiationIfNeeded(): void {
    if (this.negotiationNeeded || this.publishedTracksMissingFromSdp()) {
      this.scheduleNegotiation();
    }
  }

  private scheduleNegotiation(): void {
    if (this.negotiationScheduled) {
      // One queued task already covers every request made so far. This is
      // the coalescing: mic + camera + screen share in quick succession
      // produce one offer between them.
      return;
    }
    this.negotiationScheduled = true;
    void this.enqueue(async () => {
      this.negotiationScheduled = false;
      await this.runNegotiation();
    });
  }

  /**
   * Offers, if there is anything to offer and the connection can take one.
   *
   * Runs on the chain, so `signalingState` cannot change under it between
   * the check and `setLocalDescription`.
   */
  private async runNegotiation(): Promise<void> {
    const pc = this.pc;
    const signaling = this.signaling;
    if (!pc || !signaling) {
      return;
    }
    if (!this.negotiationNeeded && !this.publishedTracksMissingFromSdp()) {
      return;
    }

    if (pc.signalingState !== 'stable') {
      // A round is in flight. Not an error and not something to retry on
      // a timer: whoever finishes that round calls back in here.
      this.logger.debug('negotiation deferred until the current round ends', pc.signalingState);
      return;
    }

    // Cleared before the attempt, and restored on failure, so a successful
    // offer can't be re-sent by a later settle point.
    this.negotiationNeeded = false;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // This offer is every published track's one chance to have its id
      // written into the description. See `msidRefreshAttempted`.
      for (const entry of this.published.values()) {
        if (entry.sender) {
          this.msidRefreshAttempted.add(entry.trackId);
        }
      }
      this.reconcilePublicationIds(pc);
      // Send `pc.localDescription`: by now it may carry candidates the
      // pre-set copy doesn't.
      signaling.send({
        type: ClientMessageType.SDP_OFFER,
        sdp: pc.localDescription?.sdp ?? offer.sdp ?? '',
      });
    } catch (error) {
      this.negotiationNeeded = true;
      this.logger.error('could not offer', (error as Error).message);
      this.emit('mediaError', new RTCError('MEDIA_ERROR', 'Could not negotiate the published track', error));
    }
  }

  /**
   * Answers the SFU.
   *
   * Rolls our own offer back first if one is outstanding. RFC-wise either
   * peer may offer, and something has to break the tie; the SFU is the one
   * with the room-wide view, so it wins and our change is re-queued rather
   * than dropped.
   */
  private async applyRemoteOffer(sdp: string): Promise<void> {
    const pc = this.ensurePeerConnection();
    try {
      if (pc.signalingState === 'have-local-offer') {
        this.logger.debug('glare: rolling our offer back and answering the sfu');
        // No flag set here on purpose. Rolling back makes the browser
        // re-evaluate whether anything is still unnegotiated, and it
        // fires `negotiationneeded` again only if something is. Assuming
        // it is — which this code used to do — re-offers into an SFU
        // round that already carried the change, forever.
        try {
          await pc.setLocalDescription({ type: 'rollback' });
        } catch (error) {
          // Every engine Livqeno supports implements explicit rollback, and
          // `setRemoteDescription(offer)` rolls back implicitly anyway.
          // Log and carry on rather than abandoning the answer.
          this.logger.debug('explicit rollback unavailable', (error as Error).message);
        }
      }

      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Before the answer goes out, so the SFU knows which publication is
      // which by the time this description lets media flow.
      this.reconcilePublicationIds(pc);

      this.signaling?.send({
        type: ClientMessageType.SDP_ANSWER,
        sdp: pc.localDescription?.sdp ?? answer.sdp ?? '',
      });
    } catch (error) {
      this.logger.error('failed to answer offer', (error as Error).message);
      // Carry the browser's own reason. Without it this surfaces as a bare
      // "Could not answer the server's offer", which says that
      // renegotiation broke but not why — and renegotiation is exactly
      // where an m-line or direction mismatch shows up.
      // Not `Error.cause`: this package's TS target predates it, and the
      // message is what actually reaches a developer's console anyway.
      const reason = error instanceof Error ? error.message : String(error);
      this.emit('mediaError', new Error(`Could not answer the server's offer: ${reason}`));
      return;
    }

    // Back to stable, so anything of ours that was waiting can go now.
    this.afterRoundTrip();
  }

  private async applyRemoteAnswer(sdp: string): Promise<void> {
    const pc = this.pc;
    if (!pc) {
      return;
    }
    if (pc.signalingState !== 'have-local-offer') {
      // An answer to an offer we rolled back for glare. Applying it would
      // throw "Called in wrong state: stable"; the round it belonged to no
      // longer exists, and our change is already re-queued.
      this.logger.debug('discarding an answer for a superseded offer', pc.signalingState);
      this.afterRoundTrip();
      return;
    }
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      this.logger.error('failed to apply answer', (error as Error).message);
    }
    this.afterRoundTrip();
  }

  private async applyRemoteCandidate(message: {
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

  /**
   * A round ended: offer again if anything still needs one.
   *
   * Two things can: the browser's own negotiation-needed bit, and Livqeno's
   * requirement that our published tracks appear in the local description
   * by their real ids. See `publishedTracksMissingFromSdp()`.
   */
  private afterRoundTrip(): void {
    if (this.publishedTracksMissingFromSdp()) {
      this.negotiationNeeded = true;
    }
    this.scheduleNegotiationIfNeeded();
  }

  /**
   * Whether some published track's id is absent from the local
   * description's `a=msid:` lines.
   *
   * Livqeno's SFU identifies a published track by the id in the SDP `msid`
   * and matches it against the `track.publish` declaration that says
   * whether it is a camera or a screen share. So it is not enough for the
   * track to be *sending*: our id has to be the one on the wire.
   *
   * It is possible for it not to be. The SFU pre-creates a receive slot
   * for a declared track, and `addTrack` reuses that transceiver; if the
   * SFU's own next offer then covers the m-line, the browser's
   * negotiation-needed bit clears with the SFU's msid still in place. RTP
   * flows — the SFU just has no idea which of our tracks it belongs to,
   * and falls back to guessing from the codec kind. A camera guessed as a
   * camera hides it; a screen share guessed as a camera puts somebody's
   * shared window in the face tile.
   *
   * Checking the SDP rather than trusting a flag is what makes this
   * terminate: one offer of ours puts every id in place, and the answer to
   * the next check is no.
   */
  private publishedTracksMissingFromSdp(): boolean {
    const pc = this.pc;
    if (!pc || this.published.size === 0) {
      return false;
    }
    const sdp = pc.localDescription?.sdp;
    if (!sdp) {
      // Nothing negotiated yet; the offer that is coming will carry them.
      return false;
    }

    const announced = new Set<string>();
    for (const line of sdp.split(/\r?\n/)) {
      if (!line.startsWith('a=msid:')) {
        continue;
      }
      // `a=msid:<stream-id> <track-id>`; the stream-only form names no track.
      const trackId = line.slice('a=msid:'.length).trim().split(/\s+/)[1];
      if (trackId) {
        announced.add(trackId);
      }
    }

    for (const entry of this.published.values()) {
      if (!entry.sender || announced.has(entry.trackId)) {
        continue;
      }
      if (this.msidRefreshAttempted.has(entry.trackId)) {
        // Asked once already. The SFU will fall back to guessing this
        // track's source from its codec kind, which is right for a camera
        // and a microphone and wrong for a screen share — worth a warning,
        // not worth another offer.
        this.logger.warn(
          'published track is not announced by its own id; the sfu will guess its source',
          entry.trackId,
        );
        continue;
      }
      this.logger.debug('published track missing from the local sdp', entry.trackId);
      return true;
    }
    return false;
  }

  /**
   * Resolves when the data channel is open.
   *
   * What `sendData()` actually needs to wait for. Waiting on "negotiation
   * has gone quiet" instead resolves a beat too early — the browser raises
   * `negotiationneeded` on a task, so a connection looks quiet for one
   * turn after the channel was created — and the caller would be told its
   * payload had gone out while it was still queued.
   */
  private dataChannelOpened(): Promise<void> {
    if (this.dataChannel?.readyState === 'open') {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.dataChannelWaiters.push({ resolve, reject });
    });
  }

  private settleDataChannel(): void {
    const waiters = this.dataChannelWaiters;
    if (waiters.length === 0) {
      return;
    }
    this.dataChannelWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  /**
   * Fails everyone waiting on the data channel, because it is never going
   * to open.
   *
   * Only for a connection that is finished — a terminal failure or a
   * deliberate leave. A reconnect deliberately does *not* come through
   * here: rejoining re-creates the channel and settles the wait, so a
   * `sendData()` made mid-blip still goes out afterwards rather than
   * throwing at the caller.
   */
  private abortDataChannelWaiters(reason: string): void {
    const waiters = this.dataChannelWaiters;
    if (waiters.length === 0) {
      return;
    }
    this.dataChannelWaiters = [];
    const error = new RTCError('CONNECTION_FAILED', reason);
    for (const waiter of waiters) {
      waiter.reject(error);
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

    this.completeSubscription(announcement.participantId, announcement.track, event.track, event.receiver);
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
    return msidTrackIdForMid(sdp, mid);
  }

  private findAnnouncementForTrack(trackId: string): { participantId: string; track: ServerTrack } | undefined {
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
    return enabled ? this.publishKind('camera', () => createCameraTrack()) : this.unpublishKind('camera');
  }

  async enableMicrophone(enabled: boolean): Promise<LocalTrack | undefined> {
    return enabled ? this.publishKind('microphone', () => createMicrophoneTrack()) : this.unpublishKind('microphone');
  }

  async enableScreenShare(enabled: boolean): Promise<LocalTrack | undefined> {
    return enabled
      ? this.publishKind('screenShare', () => createScreenShareTrack())
      : this.unpublishKind('screenShare');
  }

  /**
   * Serializes enable/disable per kind.
   *
   * Two `enableCamera()` calls in flight at once used to mean two
   * `getUserMedia` prompts, two senders and one of them orphaned in the
   * `published` map. Callers that overlap now share the first call's
   * result. Per kind rather than global, so a microphone does not queue
   * behind a camera's device prompt.
   */
  private async withKindLock<T>(kind: TrackKind, operation: () => Promise<T>): Promise<T> {
    const previous = this.kindOperations.get(kind) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    this.kindOperations.set(
      kind,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async publishKind(kind: TrackKind, capture: () => Promise<LocalTrack>): Promise<LocalTrack | undefined> {
    return this.withKindLock(kind, () => this.publishKindLocked(kind, capture));
  }

  private async publishKindLocked(
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
    return this.withKindLock(kind, async () => {
      const existing = this.published.get(kind);
      if (!existing) {
        return undefined;
      }
      await this.unpublish(existing.track);
      return undefined;
    });
  }

  async publish(track: LocalTrack): Promise<void> {
    const delegate = track['delegate'] as unknown;
    if (!(delegate instanceof NativeLocalTrackDelegate)) {
      // Publishing needs a delegate that can hold an `RTCRtpSender`, and
      // a hand-built one has nowhere to put it. Name the way through
      // rather than just the refusal: an application-provided track goes
      // through `createCustomTrack()`.
      throw new RTCError(
        'MEDIA_ERROR',
        'This track was not created by the Livqeno SDK. Wrap your own MediaStreamTrack with createCustomTrack() (or client.createCustomTrack()) before publishing it',
      );
    }

    this.published.set(track.kind, {
      track,
      delegate,
      trackId: track.mediaStreamTrack.id,
    });
    if (!this.localParticipant.tracks.includes(track)) {
      this.localParticipant.tracks.push(track);
    }

    try {
      await this.attachToPeerConnection(track.kind);
    } catch (error) {
      // Desired state only survives if the intent is still valid. A track
      // that cannot be added at all is not published, and saying it is
      // would have a reconnect keep retrying it forever.
      this.published.delete(track.kind);
      const index = this.localParticipant.tracks.indexOf(track);
      if (index !== -1) {
        this.localParticipant.tracks.splice(index, 1);
      }
      throw error;
    }

    // `attachToPeerConnection` has already declared the source, hooked
    // the track's own `onended`, and asked for the offer that carries it.
    this.emit('localTrackPublished', track);
  }

  /**
   * Puts one desired publication onto the current PeerConnection.
   *
   * Everything the SFU needs to know about a track lives here, so the
   * first publish and a post-reconnect restore go through exactly the same
   * code and cannot drift apart. Idempotent: a track already carried by a
   * sender on this connection is left alone, which is what stops a re-sent
   * room state from adding a second sender for the same camera.
   */
  private async attachToPeerConnection(kind: TrackKind): Promise<void> {
    const entry = this.published.get(kind);
    if (!entry) {
      return;
    }
    const pc = this.ensurePeerConnection();
    const mediaStreamTrack = entry.track.mediaStreamTrack;

    const alreadyAttached = pc
      .getSenders()
      .some((sender) => sender.track !== null && sender.track === mediaStreamTrack);
    if (alreadyAttached) {
      return;
    }

    const stream = typeof MediaStream !== 'undefined' ? new MediaStream([mediaStreamTrack]) : undefined;

    let sender: RTCRtpSender;
    try {
      // `addTrack`, which reuses a compatible transceiver when one exists.
      //
      // A transceiver of our own (`addTransceiver`) would be tidier: the
      // m-section would then always announce our `msid`, and the SFU
      // could always match a track to its `track.publish` declaration
      // instead of guessing the source from the codec kind. It is not
      // shipped because this SFU does not answer a client offer that adds
      // m-sections — the offer goes out, no answer comes back, and the
      // publish never completes. Fixing that is an SFU-side change; until
      // then reuse is the path that actually carries media, and
      // `publishedTracksMissingFromSdp()` covers what it costs.
      sender = stream ? pc.addTrack(mediaStreamTrack, stream) : pc.addTrack(mediaStreamTrack);
    } catch (error) {
      throw new RTCError('MEDIA_ERROR', 'Could not add the track to the connection', error);
    }

    // Declared over signaling, never inferred from the SDP. A page can't
    // pick the stream or track id the SDP carries, since both are
    // read-only, which leaves codec kind as all the SFU would have to go
    // on. And that can't tell a screen share from a camera (spec §16).
    // Sent before negotiating, so the source is known by the time the
    // track lands on the node. Re-sent on a restore too: the SFU session
    // is new and has never heard of this track.
    const source = declaredSourceFor(kind);
    if (source) {
      this.signaling?.send({
        type: ClientMessageType.TRACK_PUBLISH,
        trackId: mediaStreamTrack.id,
        source,
      });
    }

    entry.sender = sender;
    entry.trackId = mediaStreamTrack.id;
    entry.delegate.setSender(sender);
    await this.applySimulcast(sender, kind);

    // A screen share the user stops from the browser's own bar ends the
    // track without telling us. Unpublishing here keeps the room's view
    // correct without the application having to watch for it.
    mediaStreamTrack.onended = () => {
      void this.unpublish(entry.track).catch(() => undefined);
    };

    // `addTrack` sets the browser's negotiation-needed bit and
    // `onnegotiationneeded` carries it from there. This nudge is for the
    // case the bit does not cover: a reused transceiver whose m-section
    // still announces somebody else's msid.
    this.scheduleNegotiationIfNeeded();
  }

  /**
   * Makes the publication ids we told the SFU match the ids on the wire.
   *
   * A publication's identity in this protocol is the track id in the SDP
   * `a=msid:` line. The SFU keys everything on it — the published-track
   * map, the `track.publish` source declaration, mute lookups, and the id
   * it announces to subscribers — and it reads that id off the RTP stream
   * as `TrackRemote.ID()`. Nothing else in the exchange identifies a
   * publication, which is why the id has to be right rather than merely
   * plausible.
   *
   * It was not always right. The SFU pre-creates one recvonly audio and
   * one recvonly video transceiver for every subscribing participant, so
   * that a first publish costs no extra renegotiation. `addTrack` reuses
   * those, and the m-section can keep the msid it already had —
   * Chrome will not rewrite an id it did not author. So the SFU received a
   * stream announcing one id while the declaration named another, found no
   * match, and fell back to inferring the source from the codec kind:
   * right for a camera, right for a microphone, and wrong for a screen
   * share, which then arrives labelled `camera` and lands in the face tile
   * of every layout keyed on source.
   *
   * The fix is to read what the browser actually wrote and declare that.
   * Called immediately after our own `setLocalDescription` and before the
   * description goes out, so the corrected declaration reaches the SFU
   * ahead of the media it describes — same socket, so ordering holds
   * without waiting for anything.
   *
   * No SDP is rewritten and no identifier is invented: this is the
   * protocol's existing publication id, finally taken from the one place
   * that knows it.
   */
  private reconcilePublicationIds(pc: RTCPeerConnection): void {
    const sdp = pc.localDescription?.sdp;
    if (!sdp || this.published.size === 0) {
      return;
    }

    for (const [kind, entry] of this.published) {
      if (!entry.sender) {
        continue;
      }
      const mid = pc.getTransceivers().find((t) => t.sender === entry.sender)?.mid;
      if (!mid) {
        // No mid until a description has been applied to this m-section.
        continue;
      }
      const onTheWire = msidTrackIdForMid(sdp, mid);
      if (!onTheWire || onTheWire === entry.trackId) {
        continue;
      }

      this.logger.debug(
        'publication id corrected from the sdp',
        `${kind}: ${entry.trackId} -> ${onTheWire} (mid ${mid})`,
      );
      entry.trackId = onTheWire;

      // Re-declared under the id the SFU will actually see. Everything
      // else keyed on `trackId` — mute, unpublish — now agrees with it too.
      const source = declaredSourceFor(kind);
      if (source) {
        this.signaling?.send({
          type: ClientMessageType.TRACK_PUBLISH,
          trackId: onTheWire,
          source,
        });
      }
    }
  }

  /**
   * Re-publishes everything this participant wants published onto a
   * replacement PeerConnection.
   *
   * Runs on every join, so a reconnect restores the microphone, camera and
   * screen share that were live before the outage — in one renegotiation,
   * because every `addTrack` here lands before the browser's queued
   * `negotiationneeded` task runs.
   *
   * A screen share is the one case where desired state can have expired
   * while we were away: ending the share is the user's own doing, through
   * browser UI Livqeno never sees, and its track is dead for good. Restoring
   * a dead track would publish an m-section that never carries a frame, so
   * it is dropped and the room is told, exactly as if the user had stopped
   * sharing while connected.
   */
  private restoreLocalPublications(): void {
    // The data channel is per-connection too, and a page that has used it
    // once expects it to keep working across a blip. Ahead of the tracks
    // deliberately: a room that only ever sent data has nothing in
    // `published`, and this used to sit behind an early return for that
    // case — so the channel came back only for participants who also had
    // a camera on.
    if (this.dataChannelWanted && !this.dataChannel) {
      this.openDataChannel();
    }

    // A new PeerConnection negotiates from scratch, so every track gets
    // its corrective offer again if it needs one.
    this.msidRefreshAttempted.clear();

    for (const [kind, entry] of [...this.published]) {
      if (entry.track.mediaStreamTrack.readyState === 'ended') {
        this.logger.debug('dropping a publication whose source has ended', kind);
        this.published.delete(kind);
        const index = this.localParticipant.tracks.indexOf(entry.track);
        if (index !== -1) {
          this.localParticipant.tracks.splice(index, 1);
        }
        entry.sender = undefined;
        entry.delegate.setSender(undefined);
        this.emit('localTrackUnpublished', entry.track);
        continue;
      }

      // The old sender belonged to a connection that is gone.
      entry.sender = undefined;
      entry.delegate.setSender(undefined);
      void this.attachToPeerConnection(kind).catch((error) => {
        this.logger.error('could not restore a publication', kind, (error as Error).message);
        this.emit('mediaError', error instanceof Error ? error : new Error(String(error)));
      });
    }
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
    if (entry.sender) {
      try {
        this.pc?.removeTrack(entry.sender);
      } catch (error) {
        this.logger.debug('removeTrack failed', (error as Error).message);
      }
      entry.sender = undefined;
    }
    this.msidRefreshAttempted.delete(entry.trackId);
    track.mediaStreamTrack.onended = null;
    track.mediaStreamTrack.stop();

    // `removeTrack` sets the browser's negotiation-needed bit; the offer
    // that drops the m-section comes from `onnegotiationneeded`.
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
    channel.onopen = () => {
      this.logger.debug('data channel open');
      this.settleDataChannel();
      this.flushDataQueue();
    };
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

    // A channel that arrives already open (the SFU's own, or one restored
    // on a live connection) never fires `onopen` for us.
    if (channel.readyState === 'open') {
      this.settleDataChannel();
      this.flushDataQueue();
    }
  }

  /**
   * Sends a payload, waiting for the channel if it is still coming up.
   *
   * A data channel needs its own `m=application` section, which means a
   * round trip before the first byte can go anywhere. That used to be the
   * caller's problem: `sendData()` created the channel, negotiated
   * nothing, and threw "The data channel is not open yet" — so the only
   * way to make data work was to publish a camera first and let its
   * renegotiation carry the channel along. Now the bootstrap happens here.
   */
  async sendData(payload: Uint8Array<ArrayBuffer>): Promise<void> {
    if (payload.byteLength > MAX_DATA_PAYLOAD_BYTES) {
      throw new RTCError(
        'MEDIA_ERROR',
        `Data payload is ${payload.byteLength} bytes, over the ${MAX_DATA_PAYLOAD_BYTES}-byte limit`,
      );
    }
    if (!this.pc && !this.signaling) {
      throw new RTCError('CONNECTION_FAILED', 'sendData() requires an active connection');
    }

    const channel = this.dataChannel ?? this.openDataChannel();
    if (!channel) {
      throw new RTCError('CONNECTION_FAILED', 'sendData() requires an active connection');
    }

    if (channel.readyState === 'open') {
      this.sendOnChannel(channel, payload);
      return;
    }

    // Queued rather than rejected: the caller asked to send, and the only
    // thing missing is a round trip they should not have to know about.
    // Order is preserved, so two sends before the channel opens arrive in
    // the order they were made.
    this.dataQueue.push(payload);

    // Waits for the round trip the channel needs, not for a timer.
    await this.dataChannelOpened();
    this.flushDataQueue();
  }

  /**
   * Opens the data channel for a participant that only wants to receive.
   *
   * The SFU fans data out over each recipient's own channel, so somebody
   * who never sends has nothing to receive on. `Room` calls this the
   * moment an application listens for `dataReceived`, which is the only
   * honest signal that a channel is wanted — opening one for every
   * participant at join would cost an SCTP association on every call that
   * never sends a byte.
   */
  ensureDataChannel(): void {
    this.dataChannelWanted = true;
    if (!this.dataChannel) {
      this.openDataChannel();
    }
  }

  /**
   * Creates the channel and asks for the renegotiation that carries it.
   *
   * Exactly once per connection: `dataChannel` is set synchronously here,
   * so two concurrent `sendData()` calls cannot both create one. A second
   * channel would be a second SCTP stream the SFU closes as unrecognised.
   *
   * The client creates it, not the server, because the client is the side
   * that knows it needs one. Ordered and reliable — the default, and what
   * anyone sending structured messages expects.
   */
  private openDataChannel(): RTCDataChannel | undefined {
    this.dataChannelWanted = true;
    const pc = this.pc ?? (this.signaling ? this.ensurePeerConnection() : undefined);
    if (!pc) {
      return undefined;
    }
    if (this.dataChannel) {
      return this.dataChannel;
    }

    const channel = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.attachDataChannel(channel);
    // Creating a channel needs an `m=application` section, which is a
    // local change like adding a track: the browser raises
    // `negotiationneeded` and the chain offers.
    return channel;
  }

  private flushDataQueue(): void {
    const channel = this.dataChannel;
    if (!channel || channel.readyState !== 'open' || this.dataQueue.length === 0) {
      return;
    }
    const queued = this.dataQueue;
    this.dataQueue = [];
    for (const payload of queued) {
      this.sendOnChannel(channel, payload);
    }
  }

  private sendOnChannel(channel: RTCDataChannel, payload: Uint8Array): void {
    try {
      channel.send(payload as Uint8Array<ArrayBuffer>);
    } catch (error) {
      throw new RTCError('PERMISSION_DENIED', 'Could not send data; check the token grants publishData', error);
    }
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
      entry.track.mediaStreamTrack.onended = null;
      entry.track.mediaStreamTrack.stop();
    }
    this.published.clear();
    this.localParticipant.tracks.length = 0;

    // Leaving is not a blip: the intent to publish and to hold a data
    // channel both end here, so a later `connect()` starts clean rather
    // than resurrecting a previous call's tracks.
    this.dataChannelWanted = false;
    this.dataQueue = [];
    this.negotiationNeeded = false;
    this.abortDataChannelWaiters('The room was left before the data channel could open');

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

/**
 * The track id in the `a=msid:` line of the m-section with this mid.
 *
 * `a=msid:<stream-id> <track-id>`; the stream-only form is legal and names
 * no track, and a section can carry no msid at all, so this returns
 * undefined rather than guessing. Read by mid rather than by scanning for
 * the first msid, because a participant publishing a camera and a screen
 * share has two video m-sections and picking the wrong one mislabels both.
 */
function msidTrackIdForMid(sdp: string, mid: string): string | undefined {
  // First chunk is the session section and has no m= line. Everything
  // after it is one media description.
  const sections = sdp.split(/\r?\nm=/).slice(1);
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    if (!lines.some((line) => line.trim() === `a=mid:${mid}`)) {
      continue;
    }
    const msid = lines.find((line) => line.startsWith('a=msid:'));
    const trackId = msid?.slice('a=msid:'.length).trim().split(/\s+/)[1];
    return trackId && trackId.length > 0 ? trackId : undefined;
  }
  return undefined;
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

/**
 * Reads which room this token was minted for.
 *
 * The token is a Livqeno JWT and its payload is readable, not secret. Same
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
