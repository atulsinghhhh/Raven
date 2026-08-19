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
 * concerns (framing, heartbeat, rate limiting, and — since the
 * multi-instance fix — actually delivering anything to a socket). Never
 * touches SDP content — just checks authorization and describes what
 * should be forwarded to whom; the gateway is the only thing that ever
 * touches a live WebSocket or Redis.
 */
@Injectable()
export class MessageRouterService {
  constructor(private readonly roomRegistry: RoomRegistryService) {}

  async route(
    session: ParticipantSession,
    message: InboundSignalingMessage,
  ): Promise<SignalingActionResult> {
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

  private async handleJoin(
    session: ParticipantSession,
    message: RoomJoinMessage,
  ): Promise<SignalingActionResult> {
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

    const { existingParticipantIds, wasReconnect } = await this.roomRegistry.join(session);
    session.joinedRoom = true;
    session.joinedAt = new Date();

    return {
      toSender: {
        type: ServerMessageType.ROOM_JOINED,
        roomId: session.roomId,
        participants: existingParticipantIds.map((id) => ({ id })),
      },
      toRoom: {
        roomId: session.roomId,
        excludeParticipantId: session.participantId,
        message: {
          type: ServerMessageType.PARTICIPANT_JOINED,
          participant: { id: session.participantId },
        },
      },
      // Only a genuine reconnect needs the stale session (possibly on a
      // different instance) closed — an ordinary first join has nothing
      // to kick, and skipping the broadcast keeps the common case at one
      // Redis publish instead of two.
      kickParticipant: wasReconnect
        ? { roomId: session.roomId, participantId: session.participantId, exceptConnectionId: session.connectionId }
        : undefined,
    };
  }

  private async handleLeave(session: ParticipantSession): Promise<SignalingActionResult> {
    this.requireInRoom(session);

    await this.roomRegistry.leave(session.roomId, session.participantId);
    session.joinedRoom = false;

    return {
      toSender: { type: ServerMessageType.ROOM_LEFT, roomId: session.roomId },
      toRoom: {
        roomId: session.roomId,
        excludeParticipantId: session.participantId,
        message: {
          type: ServerMessageType.PARTICIPANT_LEFT,
          participant: { id: session.participantId },
        },
      },
    };
  }

  private async handleSdpOffer(
    session: ParticipantSession,
    message: SdpOfferMessage,
  ): Promise<SignalingActionResult> {
    await this.ensureTargetReachable(session, message.targetParticipantId);
    return {
      toParticipant: {
        roomId: session.roomId,
        targetParticipantId: message.targetParticipantId,
        message: {
          type: ServerMessageType.SDP_OFFER,
          fromParticipantId: session.participantId,
          sdp: message.sdp,
        },
      },
    };
  }

  private async handleSdpAnswer(
    session: ParticipantSession,
    message: SdpAnswerMessage,
  ): Promise<SignalingActionResult> {
    await this.ensureTargetReachable(session, message.targetParticipantId);
    return {
      toParticipant: {
        roomId: session.roomId,
        targetParticipantId: message.targetParticipantId,
        message: {
          type: ServerMessageType.SDP_ANSWER,
          fromParticipantId: session.participantId,
          sdp: message.sdp,
        },
      },
    };
  }

  private async handleIceCandidate(
    session: ParticipantSession,
    message: IceCandidateMessage,
  ): Promise<SignalingActionResult> {
    await this.ensureTargetReachable(session, message.targetParticipantId);
    return {
      toParticipant: {
        roomId: session.roomId,
        targetParticipantId: message.targetParticipantId,
        message: {
          type: ServerMessageType.ICE_CANDIDATE,
          fromParticipantId: session.participantId,
          candidate: message.candidate,
        },
      },
    };
  }

  // Same-room membership is implicit here — lookup is scoped to
  // session.roomId, so a target in another room just isn't found. No
  // path exists that could leak a candidate/SDP across rooms.
  private async ensureTargetReachable(
    session: ParticipantSession,
    targetParticipantId: string,
  ): Promise<void> {
    this.requireInRoom(session);

    if (targetParticipantId === session.participantId) {
      throw new SignalingError(SignalingErrorCode.INVALID_MESSAGE, 'Cannot target yourself');
    }

    // Local-instance participants are already known without a Redis
    // round trip — most calls (both participants on the same gateway)
    // never pay for the fleet-wide check below.
    if (this.roomRegistry.get(session.roomId, targetParticipantId)) {
      return;
    }

    const existsElsewhere = await this.roomRegistry.existsFleetWide(
      session.roomId,
      targetParticipantId,
    );
    if (!existsElsewhere) {
      throw new SignalingError(
        SignalingErrorCode.PARTICIPANT_NOT_FOUND,
        `Participant ${targetParticipantId} not found in this room`,
      );
    }
  }

  private requireInRoom(session: ParticipantSession): void {
    if (!session.joinedRoom) {
      throw new SignalingError(SignalingErrorCode.NOT_IN_ROOM, 'You have not joined a room yet');
    }
  }
}
