/**
 * Raven's signaling wire protocol, as the client sees it.
 *
 * Mirrors `apps/api/src/modules/signaling/signaling.constants.ts` and
 * `interfaces/signaling-message.interface.ts`. Written out here rather
 * than imported so the SDK has no dependency on the server package —
 * three client implementations (web, React Native, Flutter) speak this,
 * and the contract has to be readable on its own.
 *
 * Note for anyone reading old code: the message *names* mostly survived
 * the move from the previous full-mesh protocol, but their meaning did
 * not. There is no `targetParticipantId` any more — a client has exactly
 * one peer, the SFU serving its room.
 */

export const ClientMessageType = {
  ROOM_JOIN: 'room.join',
  ROOM_LEAVE: 'room.leave',
  SDP_ANSWER: 'sdp.answer',
  SDP_OFFER: 'sdp.offer',
  ICE_CANDIDATE: 'ice.candidate',
  TRACK_MUTE: 'track.mute',
  /**
   * Declares what a track being published is *of*.
   *
   * Necessary because WebRTC carries no such concept and a page cannot
   * choose the `MediaStream` or `MediaStreamTrack` id the SDP will carry
   * — both are read-only. Without this the SFU can only infer source from
   * codec kind, which cannot tell a screen share from a camera.
   */
  TRACK_PUBLISH: 'track.publish',
  SUBSCRIPTION_UPDATE: 'subscription.update',
  PING: 'ping',
} as const;

export const ServerMessageType = {
  ROOM_JOINED: 'room.joined',
  ROOM_LEFT: 'room.left',
  PARTICIPANT_JOINED: 'participant.joined',
  PARTICIPANT_LEFT: 'participant.left',
  TRACK_PUBLISHED: 'track.published',
  TRACK_UNPUBLISHED: 'track.unpublished',
  TRACK_MUTED: 'track.muted',
  TRACK_UNMUTED: 'track.unmuted',
  SDP_OFFER: 'sdp.offer',
  SDP_ANSWER: 'sdp.answer',
  ICE_CANDIDATE: 'ice.candidate',
  CONNECTION_STATE: 'connection.state',
  ERROR: 'error',
  PONG: 'pong',
} as const;

export type SignalingErrorCode =
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'UNAUTHORIZED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_MESSAGE'
  | 'INVALID_MESSAGE_TYPE'
  | 'PARTICIPANT_NOT_FOUND'
  | 'NOT_IN_ROOM'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'NO_RTC_CAPACITY'
  | 'RTC_SERVER_UNREACHABLE'
  | 'NEGOTIATION_FAILED'
  | 'NEGOTIATION_GLARE';

export interface ServerTrack {
  trackId: string;
  kind: 'audio' | 'video';
  source: string;
  muted: boolean;
  simulcast: boolean;
  layers?: string[];
}

export interface ServerParticipant {
  id: string;
  tracks?: ServerTrack[];
}

export type ServerMessage =
  | { type: typeof ServerMessageType.ROOM_JOINED; roomId: string; participants: ServerParticipant[]; rtcServer?: string; region?: string }
  | { type: typeof ServerMessageType.ROOM_LEFT; roomId: string }
  | { type: typeof ServerMessageType.PARTICIPANT_JOINED; participant: ServerParticipant }
  | { type: typeof ServerMessageType.PARTICIPANT_LEFT; participant: ServerParticipant }
  | { type: typeof ServerMessageType.TRACK_PUBLISHED; participantId: string; track: ServerTrack }
  | { type: typeof ServerMessageType.TRACK_UNPUBLISHED; participantId: string; trackId: string }
  | { type: typeof ServerMessageType.TRACK_MUTED; participantId: string; trackId: string }
  | { type: typeof ServerMessageType.TRACK_UNMUTED; participantId: string; trackId: string }
  | { type: typeof ServerMessageType.SDP_OFFER; sdp: string }
  | { type: typeof ServerMessageType.SDP_ANSWER; sdp: string }
  | { type: typeof ServerMessageType.ICE_CANDIDATE; candidate: string; sdpMid?: string; sdpMLineIndex?: number; usernameFragment?: string }
  | { type: typeof ServerMessageType.CONNECTION_STATE; iceState: string; peerState: string }
  | { type: typeof ServerMessageType.ERROR; code: SignalingErrorCode; message: string }
  | { type: typeof ServerMessageType.PONG };

export type ClientMessage =
  | { type: typeof ClientMessageType.ROOM_JOIN; roomId?: string; region?: string }
  | { type: typeof ClientMessageType.ROOM_LEAVE }
  | { type: typeof ClientMessageType.SDP_ANSWER; sdp: string }
  | { type: typeof ClientMessageType.SDP_OFFER; sdp: string }
  | { type: typeof ClientMessageType.ICE_CANDIDATE; candidate: string; sdpMid?: string; sdpMLineIndex?: number; usernameFragment?: string }
  | { type: typeof ClientMessageType.TRACK_MUTE; trackId: string; muted: boolean }
  | { type: typeof ClientMessageType.TRACK_PUBLISH; trackId: string; source: 'camera' | 'microphone' | 'screenShare' }
  | { type: typeof ClientMessageType.SUBSCRIPTION_UPDATE; publisherId: string; trackId: string; layer: 'low' | 'medium' | 'high' | 'auto' }
  | { type: typeof ClientMessageType.PING };

/**
 * Error codes that mean "the credential is the problem", so reconnecting
 * with the same token cannot help.
 *
 * The distinction drives reconnect behaviour: everything else is worth
 * retrying with backoff, these need a fresh token from the application's
 * backend first.
 */
export const FATAL_ERROR_CODES: ReadonlySet<SignalingErrorCode> = new Set([
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'UNAUTHORIZED',
  'ROOM_NOT_FOUND',
  'PERMISSION_DENIED',
]);
