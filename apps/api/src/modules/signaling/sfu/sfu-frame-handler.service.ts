import { Injectable, Logger } from '@nestjs/common';
import { OutboundSignalingMessage, PublicTrack } from '../interfaces/signaling-message.interface';
import { RoomTrackRegistryService } from '../rooms/room-track-registry.service';
import { ServerMessageType, SignalingErrorCode } from '../signaling.constants';
import {
  ConnectionStatePayload,
  IceCandidatePayload,
  NodeLinkErrorCode,
  NodeLinkErrorPayload,
  NodeLinkFrame,
  NodeLinkMessageType,
  SdpPayload,
  TrackPublishedPayload,
  TrackUnpublishedPayload,
} from './node-link.interface';

/**
 * What a frame from the SFU ought to cause. Returned instead of performed,
 * so the gateway stays the only thing touching a socket or Redis. Same
 * split the message router follows in the client direction.
 */
export interface SfuFrameAction {
  /** Deliver to the one session this frame names. */
  toSession?: { sessionId: string; message: OutboundSignalingMessage };
  /** Fan out to the whole room, fleet-wide. */
  toRoom?: { roomId: string; message: OutboundSignalingMessage; excludeParticipantId?: string };
}

/**
 * Translates node-link frames into client-facing signaling messages.
 *
 * Two shapes of frame turn up here, and they fan out differently:
 *
 * - **Negotiation** (`sdp.offer`, `sdp.answer.sfu`, `ice.candidate`,
 *   `connection.state`) concerns exactly one session and goes only there.
 * - **Track changes** (`track.published`, `track.unpublished`) come
 *   addressed to the *publisher's* session, because that's the session whose
 *   PeerConnection produced them. But they're news for everybody else in
 *   the room. So they fan out, minus the publisher, who already knows.
 */
@Injectable()
export class SfuFrameHandlerService {
  private readonly logger = new Logger(SfuFrameHandlerService.name);

  constructor(private readonly trackRegistry: RoomTrackRegistryService) {}

  async handle(frame: NodeLinkFrame): Promise<SfuFrameAction> {
    switch (frame.type) {
      case NodeLinkMessageType.SDP_OFFER:
        return this.relaySdp(frame, ServerMessageType.SDP_OFFER);
      case NodeLinkMessageType.SDP_ANSWER_FROM_SFU:
        return this.relaySdp(frame, ServerMessageType.SDP_ANSWER);
      case NodeLinkMessageType.ICE_CANDIDATE:
        return this.relayIceCandidate(frame);
      case NodeLinkMessageType.CONNECTION_STATE:
        return this.relayConnectionState(frame);
      case NodeLinkMessageType.TRACK_PUBLISHED:
        return this.handleTrackPublished(frame);
      case NodeLinkMessageType.TRACK_UNPUBLISHED:
        return this.handleTrackUnpublished(frame);
      case NodeLinkMessageType.ERROR:
        return this.relayError(frame);
      case NodeLinkMessageType.PARTICIPANT_STATS:
      case NodeLinkMessageType.ROOM_STATE_RESULT:
        // Not client-facing. Stats feed telemetry and room state answers
        // dashboard queries. Both get handled where they're asked for, not
        // relayed down some client's socket.
        return {};
      default:
        this.logger.warn(`unexpected node-link frame from SFU: ${frame.type}`);
        return {};
    }
  }

  private relaySdp(
    frame: NodeLinkFrame,
    type: ServerMessageType.SDP_OFFER | ServerMessageType.SDP_ANSWER,
  ): SfuFrameAction {
    const payload = frame.payload as SdpPayload | undefined;
    if (!frame.sessionId || !payload?.sdp) {
      this.logger.warn(`dropping malformed ${frame.type} frame`);
      return {};
    }
    return { toSession: { sessionId: frame.sessionId, message: { type, sdp: payload.sdp } } };
  }

  private relayIceCandidate(frame: NodeLinkFrame): SfuFrameAction {
    const payload = frame.payload as IceCandidatePayload | undefined;
    if (!frame.sessionId || !payload?.candidate) {
      return {};
    }
    return {
      toSession: {
        sessionId: frame.sessionId,
        message: {
          type: ServerMessageType.ICE_CANDIDATE,
          candidate: payload.candidate,
          sdpMid: payload.sdpMid,
          sdpMLineIndex: payload.sdpMLineIndex,
          usernameFragment: payload.usernameFragment,
        },
      },
    };
  }

  private relayConnectionState(frame: NodeLinkFrame): SfuFrameAction {
    const payload = frame.payload as ConnectionStatePayload | undefined;
    if (!frame.sessionId || !payload) {
      return {};
    }
    return {
      toSession: {
        sessionId: frame.sessionId,
        message: {
          type: ServerMessageType.CONNECTION_STATE,
          iceState: payload.iceState,
          peerState: payload.peerState,
        },
      },
    };
  }

  private async handleTrackPublished(frame: NodeLinkFrame): Promise<SfuFrameAction> {
    const payload = frame.payload as TrackPublishedPayload | undefined;
    if (!frame.roomId || !payload?.trackId) {
      return {};
    }

    const track: PublicTrack = {
      trackId: payload.trackId,
      kind: payload.kind === 'audio' ? 'audio' : 'video',
      source: payload.source,
      muted: false,
      simulcast: payload.simulcast,
      layers: payload.layers,
    };

    // Recorded before we fan out, so a client joining a moment later finds
    // this track in its `room.joined` instead of missing it until the next
    // change.
    await this.trackRegistry.publish(frame.roomId, payload.participantId, track);

    this.logger.log(
      `track published: room=${frame.roomId} participant=${payload.participantId} ` +
        `track=${payload.trackId} kind=${payload.kind} source=${payload.source} simulcast=${payload.simulcast}`,
    );

    return {
      toRoom: {
        roomId: frame.roomId,
        // The publisher's own SDK already knows. It asked for this.
        excludeParticipantId: payload.participantId,
        message: {
          type: ServerMessageType.TRACK_PUBLISHED,
          participantId: payload.participantId,
          track,
        },
      },
    };
  }

  private async handleTrackUnpublished(frame: NodeLinkFrame): Promise<SfuFrameAction> {
    const payload = frame.payload as TrackUnpublishedPayload | undefined;
    if (!frame.roomId || !payload?.trackId) {
      return {};
    }

    await this.trackRegistry.unpublish(frame.roomId, payload.participantId, payload.trackId);

    this.logger.log(
      `track unpublished: room=${frame.roomId} participant=${payload.participantId} track=${payload.trackId}`,
    );

    return {
      toRoom: {
        roomId: frame.roomId,
        excludeParticipantId: payload.participantId,
        message: {
          type: ServerMessageType.TRACK_UNPUBLISHED,
          participantId: payload.participantId,
          trackId: payload.trackId,
        },
      },
    };
  }

  /**
   * Passes an SFU-side failure back to whichever client caused it.
   *
   * The node's error vocabulary is coarser than the client's, so this maps
   * rather than forwards. And the only *message* it ever forwards is one the
   * node itself wrote, never one derived from client input, so there's
   * nothing here that could reflect an attacker's payload back at them.
   */
  private relayError(frame: NodeLinkFrame): SfuFrameAction {
    const payload = frame.payload as NodeLinkErrorPayload | undefined;
    if (!frame.sessionId || !payload) {
      return {};
    }

    this.logger.warn(
      `sfu reported an error: session=${frame.sessionId} room=${frame.roomId ?? '-'} ` +
        `code=${payload.code} message=${payload.message}`,
    );

    return {
      toSession: {
        sessionId: frame.sessionId,
        message: {
          type: ServerMessageType.ERROR,
          code: mapNodeErrorCode(payload.code),
          message: clientMessageFor(payload.code, payload.message),
        },
      },
    };
  }
}

function mapNodeErrorCode(code: string): SignalingErrorCode {
  switch (code) {
    case NodeLinkErrorCode.ROOM_FULL:
      return SignalingErrorCode.ROOM_FULL;
    case NodeLinkErrorCode.PERMISSION_DENIED:
      return SignalingErrorCode.PERMISSION_DENIED;
    case NodeLinkErrorCode.NEGOTIATION_GLARE:
      return SignalingErrorCode.NEGOTIATION_GLARE;
    case NodeLinkErrorCode.NEGOTIATION_FAILED:
      return SignalingErrorCode.NEGOTIATION_FAILED;
    case NodeLinkErrorCode.UNKNOWN_SESSION:
      // The node has no PeerConnection for this session. The client's media
      // session is gone even though its WebSocket is perfectly fine.
      // Rejoining is the only way out, so say that rather than "unknown
      // session", which nobody can act on.
      return SignalingErrorCode.NOT_IN_ROOM;
    default:
      return SignalingErrorCode.NEGOTIATION_FAILED;
  }
}

/**
 * What the client actually gets told.
 *
 * Glare gets a specific, actionable message, because the SDK is expected to
 * retry on it. Everything else gets a generic one. An SFU's internal
 * failure detail is operator information; it belongs in the log line above,
 * not in somebody's error handler.
 */
function clientMessageFor(code: string, nodeMessage: string): string {
  switch (code) {
    case NodeLinkErrorCode.NEGOTIATION_GLARE:
      return 'An offer from the server is already in flight; answer it, then retry';
    case NodeLinkErrorCode.ROOM_FULL:
      return 'This room is full';
    case NodeLinkErrorCode.PERMISSION_DENIED:
      return 'Your token does not grant this';
    case NodeLinkErrorCode.UNKNOWN_SESSION:
      return 'Your media session is no longer active — rejoin the room';
    default:
      void nodeMessage;
      return 'The RTC server could not complete this request';
  }
}
