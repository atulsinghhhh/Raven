import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IceCandidateMessage,
  InboundSignalingMessage,
  RoomJoinMessage,
  SdpAnswerMessage,
  SdpOfferMessage,
} from '../interfaces/signaling-message.interface';
import { SignalingError } from '../signaling-error';
import { ClientMessageType, SignalingErrorCode } from '../signaling.constants';

const KNOWN_TYPES = new Set<string>(Object.values(ClientMessageType));

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Every message a client sends passes through here before any handler
 * sees it. Nothing is forwarded blindly — unknown types, missing fields,
 * wrong field types, and oversized payloads are all rejected here, not
 * downstream. See docs/signaling-protocol.md for the authoritative shape
 * of each message type.
 */
@Injectable()
export class MessageValidatorService {
  constructor(private readonly configService: ConfigService) {}

  parse(raw: Buffer | ArrayBuffer | Buffer[] | string): InboundSignalingMessage {
    const byteLength = Buffer.isBuffer(raw)
      ? raw.length
      : Buffer.byteLength(typeof raw === 'string' ? raw : Buffer.from(raw as ArrayBuffer));
    const maxBytes = this.configService.get<number>('signaling.maxMessageBytes')!;

    if (byteLength > maxBytes) {
      throw new SignalingError(
        SignalingErrorCode.INVALID_MESSAGE,
        `Message exceeds maximum size of ${maxBytes} bytes`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      throw new SignalingError(SignalingErrorCode.INVALID_MESSAGE, 'Message is not valid JSON');
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new SignalingError(SignalingErrorCode.INVALID_MESSAGE, 'Message must be a JSON object');
    }

    const candidate = parsed as Record<string, unknown>;
    const type = candidate.type;

    if (!isNonEmptyString(type) || !KNOWN_TYPES.has(type)) {
      throw new SignalingError(
        SignalingErrorCode.INVALID_MESSAGE_TYPE,
        `Unknown message type: ${String(type)}`,
      );
    }

    return this.validateByType(type as ClientMessageType, candidate);
  }

  private validateByType(
    type: ClientMessageType,
    candidate: Record<string, unknown>,
  ): InboundSignalingMessage {
    switch (type) {
      case ClientMessageType.ROOM_JOIN: {
        if (candidate.roomId !== undefined && !isNonEmptyString(candidate.roomId)) {
          throw this.missingField('roomId');
        }
        return { type, roomId: candidate.roomId as string | undefined } satisfies RoomJoinMessage;
      }

      case ClientMessageType.ROOM_LEAVE:
      case ClientMessageType.PING:
        return { type } as InboundSignalingMessage;

      case ClientMessageType.SDP_OFFER:
      case ClientMessageType.SDP_ANSWER: {
        if (!isNonEmptyString(candidate.targetParticipantId)) {
          throw this.missingField('targetParticipantId');
        }
        if (!isNonEmptyString(candidate.sdp)) {
          throw this.missingField('sdp');
        }
        return {
          type,
          targetParticipantId: candidate.targetParticipantId,
          sdp: candidate.sdp,
        } as SdpOfferMessage | SdpAnswerMessage;
      }

      case ClientMessageType.ICE_CANDIDATE: {
        if (!isNonEmptyString(candidate.targetParticipantId)) {
          throw this.missingField('targetParticipantId');
        }
        if (candidate.candidate === undefined || candidate.candidate === null) {
          throw this.missingField('candidate');
        }
        return {
          type,
          targetParticipantId: candidate.targetParticipantId,
          candidate: candidate.candidate,
        } satisfies IceCandidateMessage;
      }

      /* istanbul ignore next -- exhaustiveness guard, unreachable given KNOWN_TYPES check above */
      default:
        throw new SignalingError(SignalingErrorCode.INVALID_MESSAGE_TYPE, `Unknown message type`);
    }
  }

  private missingField(field: string): SignalingError {
    return new SignalingError(SignalingErrorCode.INVALID_MESSAGE, `Missing or invalid field: ${field}`);
  }
}
