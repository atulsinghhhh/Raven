import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IceCandidateMessage,
  InboundSignalingMessage,
  RoomJoinMessage,
  SdpAnswerMessage,
  SdpOfferMessage,
  SubscriptionUpdateMessage,
  TrackMuteMessage,
  TrackPublishMessage,
} from '../interfaces/signaling-message.interface';
import { SignalingError } from '../signaling-error';
import { ClientMessageType, SignalingErrorCode } from '../signaling.constants';

const KNOWN_TYPES = new Set<string>(Object.values(ClientMessageType));

const SIMULCAST_LAYERS = new Set(['low', 'medium', 'high', 'auto']);

const TRACK_SOURCES = new Set(['camera', 'microphone', 'screenShare']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Every client message passes through here before any handler sees it.
 * Nothing gets forwarded blindly: unknown types, missing fields, wrong
 * field types, oversized payloads all get rejected here, not downstream.
 *
 * SDP bodies are checked for presence and type but never parsed: the SFU's
 * `SetRemoteDescription` is the only thing that can judge whether an SDP is
 * valid, and a hand-rolled pre-parse here would reject session
 * descriptions that are perfectly legal but unusual. What matters at this
 * layer is that the field exists, is a string, and fits the size budget.
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
      throw new SignalingError(SignalingErrorCode.INVALID_MESSAGE, `Message exceeds maximum size of ${maxBytes} bytes`);
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
      throw new SignalingError(SignalingErrorCode.INVALID_MESSAGE_TYPE, `Unknown message type: ${String(type)}`);
    }

    return this.validateByType(type as ClientMessageType, candidate);
  }

  private validateByType(type: ClientMessageType, candidate: Record<string, unknown>): InboundSignalingMessage {
    switch (type) {
      case ClientMessageType.ROOM_JOIN: {
        if (candidate.roomId !== undefined && !isNonEmptyString(candidate.roomId)) {
          throw this.missingField('roomId');
        }
        if (candidate.region !== undefined && !isNonEmptyString(candidate.region)) {
          throw this.missingField('region');
        }
        return {
          type,
          roomId: candidate.roomId as string | undefined,
          region: candidate.region as string | undefined,
        } satisfies RoomJoinMessage;
      }

      case ClientMessageType.ROOM_LEAVE:
      case ClientMessageType.PING:
        return { type } as InboundSignalingMessage;

      case ClientMessageType.SDP_OFFER:
      case ClientMessageType.SDP_ANSWER: {
        // No `targetParticipantId`. Requiring one was the defining
        // feature of the mesh protocol this replaced: the client has
        // exactly one peer now, the SFU serving its room.
        if (!isNonEmptyString(candidate.sdp)) {
          throw this.missingField('sdp');
        }
        return { type, sdp: candidate.sdp } as SdpOfferMessage | SdpAnswerMessage;
      }

      case ClientMessageType.ICE_CANDIDATE: {
        if (!isNonEmptyString(candidate.candidate)) {
          throw this.missingField('candidate');
        }
        if (candidate.sdpMid !== undefined && typeof candidate.sdpMid !== 'string') {
          throw this.missingField('sdpMid');
        }
        if (
          candidate.sdpMLineIndex !== undefined &&
          (typeof candidate.sdpMLineIndex !== 'number' || !Number.isInteger(candidate.sdpMLineIndex))
        ) {
          throw this.missingField('sdpMLineIndex');
        }
        if (candidate.usernameFragment !== undefined && typeof candidate.usernameFragment !== 'string') {
          throw this.missingField('usernameFragment');
        }
        return {
          type,
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid as string | undefined,
          sdpMLineIndex: candidate.sdpMLineIndex as number | undefined,
          usernameFragment: candidate.usernameFragment as string | undefined,
        } satisfies IceCandidateMessage;
      }

      case ClientMessageType.TRACK_MUTE: {
        if (!isNonEmptyString(candidate.trackId)) {
          throw this.missingField('trackId');
        }
        if (typeof candidate.muted !== 'boolean') {
          throw this.missingField('muted');
        }
        return { type, trackId: candidate.trackId, muted: candidate.muted } satisfies TrackMuteMessage;
      }

      case ClientMessageType.TRACK_PUBLISH: {
        if (!isNonEmptyString(candidate.trackId)) {
          throw this.missingField('trackId');
        }
        // Rejected, not defaulted: a source we do not recognise
        // would be silently rendered as a camera, and a screen share
        // shown as somebody's face is a worse outcome than an error.
        if (!isNonEmptyString(candidate.source) || !TRACK_SOURCES.has(candidate.source)) {
          throw new SignalingError(
            SignalingErrorCode.INVALID_MESSAGE,
            `source must be one of: ${Array.from(TRACK_SOURCES).join(', ')}`,
          );
        }
        return {
          type,
          trackId: candidate.trackId,
          source: candidate.source as TrackPublishMessage['source'],
        } satisfies TrackPublishMessage;
      }

      case ClientMessageType.SUBSCRIPTION_UPDATE: {
        if (!isNonEmptyString(candidate.publisherId)) {
          throw this.missingField('publisherId');
        }
        if (!isNonEmptyString(candidate.trackId)) {
          throw this.missingField('trackId');
        }
        // Rejected rather than defaulted to 'auto': a client sending a
        // layer name we do not recognise has a bug, and silently
        // substituting a different quality would hide it.
        if (!isNonEmptyString(candidate.layer) || !SIMULCAST_LAYERS.has(candidate.layer)) {
          throw new SignalingError(
            SignalingErrorCode.INVALID_MESSAGE,
            `layer must be one of: ${Array.from(SIMULCAST_LAYERS).join(', ')}`,
          );
        }
        return {
          type,
          publisherId: candidate.publisherId,
          trackId: candidate.trackId,
          layer: candidate.layer as SubscriptionUpdateMessage['layer'],
        } satisfies SubscriptionUpdateMessage;
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
