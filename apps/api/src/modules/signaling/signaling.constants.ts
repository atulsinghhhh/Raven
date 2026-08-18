// Wire protocol constants for the signaling layer. Full contract is in
// docs/signaling-protocol.md — this file is the source of truth for it.

export enum ClientMessageType {
  ROOM_JOIN = 'room.join',
  ROOM_LEAVE = 'room.leave',
  SDP_OFFER = 'sdp.offer',
  SDP_ANSWER = 'sdp.answer',
  ICE_CANDIDATE = 'ice.candidate',
  PING = 'ping',
}

export enum ServerMessageType {
  ROOM_JOINED = 'room.joined',
  ROOM_LEFT = 'room.left',
  PARTICIPANT_JOINED = 'participant.joined',
  PARTICIPANT_LEFT = 'participant.left',
  SDP_OFFER = 'sdp.offer',
  SDP_ANSWER = 'sdp.answer',
  ICE_CANDIDATE = 'ice.candidate',
  ERROR = 'error',
  PONG = 'pong',
}

export enum SignalingErrorCode {
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_FULL = 'ROOM_FULL',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  INVALID_MESSAGE_TYPE = 'INVALID_MESSAGE_TYPE',
  PARTICIPANT_NOT_FOUND = 'PARTICIPANT_NOT_FOUND',
  NOT_IN_ROOM = 'NOT_IN_ROOM',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RATE_LIMITED = 'RATE_LIMITED',
}

// Not in .env on purpose — these are wire-protocol/operational constants,
// not per-deployment config. Stuff that actually varies by deployment
// (max participants, message rate) lives under `signaling` in
// configuration.ts instead.
export const SIGNALING_PATH = '/v1/rtc';
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 60_000; // one missed cycle before termination
