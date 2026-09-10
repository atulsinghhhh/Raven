/**
 * Raven's signaling wire protocol, as the client sees it.
 *
 * Mirrors `apps/api/src/modules/signaling/signaling.constants.ts` and
 * `interfaces/signaling-message.interface.ts`. Written out by hand rather
 * than imported, so the SDK carries no dependency on the server package.
 * Three client implementations speak this (web, React Native, Flutter) and
 * the contract has to stand on its own.
 *
 * Warning if you're reading older code: most of the message *names*
 * survived the move off the old full-mesh protocol, but their meanings
 * didn't. `targetParticipantId` is gone. A client has exactly one peer
 * now: the SFU serving its room.
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
   * Needed because WebRTC has no such concept, and a page can't choose the
   * `MediaStream` or `MediaStreamTrack` id the SDP will carry; both are
   * read-only. Without this the SFU can only guess the source from codec
   * kind, and that can't tell a screen share from a camera.
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
  | 'TOKEN_REVOKED'
  | 'UNAUTHORIZED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_MESSAGE'
  | 'INVALID_MESSAGE_TYPE'
  | 'PARTICIPANT_NOT_FOUND'
  | 'NOT_IN_ROOM'
  | 'PERMISSION_DENIED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'USAGE_LIMIT_EXCEEDED'
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
 * Error codes meaning "the credential is the problem", where reconnecting
 * on the same token can't possibly help.
 *
 * The split drives reconnect behaviour. Everything else is worth retrying
 * with backoff; these want a fresh token from the application's backend
 * first.
 */
export const FATAL_ERROR_CODES: ReadonlySet<SignalingErrorCode> = new Set([
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  // Someone killed this credential on purpose. Retrying re-presents the
  // same dead token; the application's backend has to mint a new one.
  'TOKEN_REVOKED',
  'UNAUTHORIZED',
  'ROOM_NOT_FOUND',
  'PERMISSION_DENIED',
  // Reconnecting cannot help: the page's origin is not on the project's
  // allow-list, and that is changed in the dashboard, not by retrying.
  'ORIGIN_NOT_ALLOWED',
  // Not a credential problem, but just as terminal, and it belongs here
  // for the reconnect behaviour rather than the reason. The account is out
  // of included minutes: unlike RATE_LIMITED there is no window to wait
  // out, so backing off and retrying would spin against a wall until the
  // attempt budget ran out. A fresh token would not help either — the
  // limit is on the account, not the token.
  'USAGE_LIMIT_EXCEEDED',
]);
