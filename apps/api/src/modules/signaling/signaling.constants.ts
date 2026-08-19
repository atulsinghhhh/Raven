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

/**
 * Redis key namespace for fleet-wide room state, mirroring
 * chat.constants.ts's `RedisKeys` convention. Every key here carries a
 * TTL — same reasoning as chat's presence/connection keys — so a gateway
 * that dies mid-heartbeat doesn't leave phantom participants behind.
 */
export const SignalingRedisKeys = {
  /** Set of participantIds currently in the room, fleet-wide. */
  roomParticipants: (roomId: string) => `raven:signaling:room:${roomId}:participants`,
  /** participantId -> {gatewayId}. Lets any instance locate who holds a target's socket. */
  participant: (roomId: string, participantId: string) =>
    `raven:signaling:room:${roomId}:participant:${participantId}`,
  /** Pub/sub channel for this room, one per room, subscribed to on demand. */
  roomChannel: (roomId: string) => `raven:signaling:room:${roomId}:events`,
} as const;

/**
 * Outlives one full missed heartbeat cycle plus a safety margin, so a
 * gateway that dies mid-cycle doesn't leave a fleet-wide phantom
 * participant around much longer than a live one would take to be
 * cleaned up locally by the heartbeat sweep.
 */
export const SIGNALING_PARTICIPANT_TTL_SECONDS = Math.ceil((HEARTBEAT_TIMEOUT_MS * 2) / 1000);
