import { Injectable } from '@nestjs/common';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import {
  IceCandidateMessage,
  InboundSignalingMessage,
  RoomJoinMessage,
  SdpAnswerMessage,
  SdpOfferMessage,
} from '../interfaces/signaling-message.interface';
import { RoomRegistryService } from '../rooms/room-registry.service';
import { SignalingError } from '../signaling-error';
import { ClientMessageType, ServerMessageType, SignalingErrorCode } from '../signaling.constants';
import { SignalingActionResult } from './signaling-action.interface';

/**
 * Pure message-routing logic, kept separate from the gateway's transport
 * concerns (framing, heartbeat, rate limiting). Never touches SDP
 * content — just checks authorization and forwards.
 */
@Injectable()
export class MessageRouterService {
  constructor(private readonly roomRegistry: RoomRegistryService) {}

  route(session: ParticipantSession, message: InboundSignalingMessage): SignalingActionResult {
    switch (message.type) {
      case ClientMessageType.ROOM_JOIN:
        return this.handleJoin(session, message);
      case ClientMessageType.ROOM_LEAVE:
        return this.handleLeave(session);
      case ClientMessageType.SDP_OFFER:
        return this.handleSdpOffer(session, message);
      case ClientMessageType.SDP_ANSWER:
        return this.handleSdpAnswer(session, message);
      case ClientMessageType.ICE_CANDIDATE:
        return this.handleIceCandidate(session, message);
      case ClientMessageType.PING:
        return { toSender: { type: ServerMessageType.PONG } };
    }
  }

  private handleJoin(session: ParticipantSession, message: RoomJoinMessage): SignalingActionResult {
    if (!session.permissions.join) {
      throw new SignalingError(SignalingErrorCode.PERMISSION_DENIED, 'join permission required');
    }

    // The RTC token is what actually authorizes the room — if the client
    // sends a roomId too, it has to match the token, not override it.
    if (message.roomId && message.roomId !== session.roomId) {
      throw new SignalingError(
        SignalingErrorCode.UNAUTHORIZED,
        'roomId does not match the room authorized by this RTC token',
      );
    }

    const { replaced, existingParticipants } = this.roomRegistry.join(session);
    session.joinedRoom = true;
    session.joinedAt = new Date();

    return {
      toSender: {
        type: ServerMessageType.ROOM_JOINED,
        roomId: session.roomId,
        participants: existingParticipants.map((p) => ({ id: p.participantId })),
      },
      toOthers: existingParticipants.map((p) => ({
        session: p,
        message: {
          type: ServerMessageType.PARTICIPANT_JOINED,
          participant: { id: session.participantId },
        },
      })),
      kick: replaced ?? undefined,
    };
  }

  private handleLeave(session: ParticipantSession): SignalingActionResult {
    this.requireInRoom(session);

    const removed = this.roomRegistry.leave(session.roomId, session.participantId);
    session.joinedRoom = false;
    const others = this.roomRegistry.listParticipants(session.roomId);

    return {
      toSender: { type: ServerMessageType.ROOM_LEFT, roomId: session.roomId },
      toOthers: removed
        ? others.map((p) => ({
            session: p,
            message: {
              type: ServerMessageType.PARTICIPANT_LEFT,
              participant: { id: session.participantId },
            },
          }))
        : [],
    };
  }

  private handleSdpOffer(
    session: ParticipantSession,
    message: SdpOfferMessage,
  ): SignalingActionResult {
    const target = this.resolveTarget(session, message.targetParticipantId);
    return {
      toOthers: [
        {
          session: target,
          message: {
            type: ServerMessageType.SDP_OFFER,
            fromParticipantId: session.participantId,
            sdp: message.sdp,
          },
        },
      ],
    };
  }

  private handleSdpAnswer(
    session: ParticipantSession,
    message: SdpAnswerMessage,
  ): SignalingActionResult {
    const target = this.resolveTarget(session, message.targetParticipantId);
    return {
      toOthers: [
        {
          session: target,
          message: {
            type: ServerMessageType.SDP_ANSWER,
            fromParticipantId: session.participantId,
            sdp: message.sdp,
          },
        },
      ],
    };
  }

  private handleIceCandidate(
    session: ParticipantSession,
    message: IceCandidateMessage,
  ): SignalingActionResult {
    const target = this.resolveTarget(session, message.targetParticipantId);
    return {
      toOthers: [
        {
          session: target,
          message: {
            type: ServerMessageType.ICE_CANDIDATE,
            fromParticipantId: session.participantId,
            candidate: message.candidate,
          },
        },
      ],
    };
  }

  // Same-room membership is implicit here — lookup is scoped to
  // session.roomId, so a target in another room just isn't found. No
  // path exists that could leak a candidate/SDP across rooms.
  private resolveTarget(session: ParticipantSession, targetParticipantId: string): ParticipantSession {
    this.requireInRoom(session);

    if (targetParticipantId === session.participantId) {
      throw new SignalingError(SignalingErrorCode.INVALID_MESSAGE, 'Cannot target yourself');
    }

    const target = this.roomRegistry.get(session.roomId, targetParticipantId);
    if (!target) {
      throw new SignalingError(
        SignalingErrorCode.PARTICIPANT_NOT_FOUND,
        `Participant ${targetParticipantId} not found in this room`,
      );
    }

    return target;
  }

  private requireInRoom(session: ParticipantSession): void {
    if (!session.joinedRoom) {
      throw new SignalingError(SignalingErrorCode.NOT_IN_ROOM, 'You have not joined a room yet');
    }
  }
}
