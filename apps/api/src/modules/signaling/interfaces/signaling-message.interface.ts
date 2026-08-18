import { ClientMessageType, ServerMessageType, SignalingErrorCode } from '../signaling.constants';

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface RoomJoinMessage {
  type: ClientMessageType.ROOM_JOIN;
  /** Optional — if present, must match the room bound to the connection's RTC token. */
  roomId?: string;
}

export interface RoomLeaveMessage {
  type: ClientMessageType.ROOM_LEAVE;
}

export interface SdpOfferMessage {
  type: ClientMessageType.SDP_OFFER;
  targetParticipantId: string;
  sdp: string;
}

export interface SdpAnswerMessage {
  type: ClientMessageType.SDP_ANSWER;
  targetParticipantId: string;
  sdp: string;
}

export interface IceCandidateMessage {
  type: ClientMessageType.ICE_CANDIDATE;
  targetParticipantId: string;
  candidate: unknown;
}

export interface PingMessage {
  type: ClientMessageType.PING;
}

export type InboundSignalingMessage =
  | RoomJoinMessage
  | RoomLeaveMessage
  | SdpOfferMessage
  | SdpAnswerMessage
  | IceCandidateMessage
  | PingMessage;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export interface PublicParticipant {
  id: string;
}

export interface RoomJoinedMessage {
  type: ServerMessageType.ROOM_JOINED;
  roomId: string;
  participants: PublicParticipant[];
}

export interface RoomLeftMessage {
  type: ServerMessageType.ROOM_LEFT;
  roomId: string;
}

export interface ParticipantJoinedMessage {
  type: ServerMessageType.PARTICIPANT_JOINED;
  participant: PublicParticipant;
}

export interface ParticipantLeftMessage {
  type: ServerMessageType.PARTICIPANT_LEFT;
  participant: PublicParticipant;
}

export interface SdpOfferRelayMessage {
  type: ServerMessageType.SDP_OFFER;
  fromParticipantId: string;
  sdp: string;
}

export interface SdpAnswerRelayMessage {
  type: ServerMessageType.SDP_ANSWER;
  fromParticipantId: string;
  sdp: string;
}

export interface IceCandidateRelayMessage {
  type: ServerMessageType.ICE_CANDIDATE;
  fromParticipantId: string;
  candidate: unknown;
}

export interface ErrorMessage {
  type: ServerMessageType.ERROR;
  code: SignalingErrorCode;
  message: string;
}

export interface PongMessage {
  type: ServerMessageType.PONG;
}

export type OutboundSignalingMessage =
  | RoomJoinedMessage
  | RoomLeftMessage
  | ParticipantJoinedMessage
  | ParticipantLeftMessage
  | SdpOfferRelayMessage
  | SdpAnswerRelayMessage
  | IceCandidateRelayMessage
  | ErrorMessage
  | PongMessage;
