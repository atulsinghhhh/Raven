/**
 * The node-link wire contract, mirroring
 * `services/sfu/internal/signal/protocol.go`.
 *
 * Two processes in two languages have to agree on this, so it's written out
 * by hand on both sides instead of generated. Change one, change the
 * other. No build step will catch a drift; only the node-link e2e test
 * will.
 *
 * `sessionId` is the control plane's own connection id, reused as the
 * session identifier on the link, so a log line on either side joins to the
 * other with no translation table in between.
 */
export interface NodeLinkFrame {
  type: NodeLinkMessageType;
  sessionId?: string;
  roomId?: string;
  payload?: unknown;
  /**
   * Correlates a query with its reply.
   *
   * Kept separate from `sessionId` on purpose. Session-scoped frames bind a
   * session to the link they arrived on, so correlating a query by session
   * id would register a session that doesn't exist and then get it swept up
   * as an orphan on the node. A query is about a room, not a participant, so
   * it gets an identifier of its own.
   */
  requestId?: string;
}

export enum NodeLinkMessageType {
  // --- Control plane → SFU -------------------------------------------
  PARTICIPANT_ADD = 'participant.add',
  PARTICIPANT_REMOVE = 'participant.remove',
  SDP_ANSWER = 'sdp.answer',
  /**
   * A client-initiated offer. Named differently from the SFU's own
   * `sdp.offer`, so a frame's direction is obvious from the type alone
   * rather than from knowing which side read it.
   */
  SDP_OFFER_FROM_CLIENT = 'sdp.offer.client',
  ICE_CANDIDATE = 'ice.candidate',
  TRACK_MUTE = 'track.mute',
  /** Tells the node what a track being published is of, before it arrives. */
  TRACK_SOURCE = 'track.source',
  SUBSCRIPTION_UPDATE = 'subscription.update',
  ROOM_CLOSE = 'room.close',
  ROOM_STATE = 'room.state',
  /**
   * Re-binds an idle session to this link.
   *
   * Sessions on the SFU belong to whichever link created them, so an
   * instance reconnecting its link has to re-claim them. Negotiation traffic
   * does that by itself; this covers the sessions that have none.
   */
  SESSION_KEEPALIVE = 'session.keepalive',

  // --- SFU → control plane -------------------------------------------
  SDP_OFFER = 'sdp.offer',
  SDP_ANSWER_FROM_SFU = 'sdp.answer.sfu',
  TRACK_PUBLISHED = 'track.published',
  TRACK_UNPUBLISHED = 'track.unpublished',
  CONNECTION_STATE = 'connection.state',
  PARTICIPANT_STATS = 'participant.stats',
  ROOM_STATE_RESULT = 'room.state.result',
  ERROR = 'error',
}

/** The SFU's copy of a participant's grant. It enforces them itself (spec §38). */
export interface NodeLinkPermissions {
  publish: boolean;
  subscribe: boolean;
  publishAudio: boolean;
  publishVideo: boolean;
  publishData: boolean;
}

export interface ParticipantAddPayload {
  participantId: string;
  permissions: NodeLinkPermissions;
}

export interface SdpPayload {
  sdp: string;
  /** `'offer'` or `'answer'`, carried explicitly so a mismatched pair fails loudly. */
  type: string;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
}

export interface TrackMutePayload {
  trackId: string;
  muted: boolean;
}

export interface TrackSourcePayload {
  trackId: string;
  source: string;
}

export interface SubscriptionUpdatePayload {
  publisherId: string;
  trackId: string;
  layer: string;
}

export interface TrackPublishedPayload {
  participantId: string;
  trackId: string;
  kind: string;
  source: string;
  simulcast: boolean;
  layers?: string[];
}

export interface TrackUnpublishedPayload {
  participantId: string;
  trackId: string;
}

export interface ConnectionStatePayload {
  iceState: string;
  peerState: string;
}

/**
 * The SFU's own measurement of a participant's link.
 *
 * Every field is optional, because anything the node hasn't measured gets
 * omitted rather than zeroed. Zero packet loss and "no report has arrived
 * yet" must never look the same (spec §19).
 */
export interface ParticipantStatsPayload {
  participantId: string;
  rttMs?: number;
  jitterMs?: number;
  packetLossPct?: number;
  inboundBps?: number;
  outboundBps?: number;
  publishedTracks: number;
  subscribedTracks: number;
}

export interface RoomStateResultPayload {
  roomId: string;
  participants: RoomStateParticipant[];
}

export interface RoomStateParticipant {
  participantId: string;
  sessionId: string;
  /** Unix seconds. */
  joinedAt: number;
  peerState: string;
  tracks: RoomStateTrack[];
}

export interface RoomStateTrack {
  trackId: string;
  kind: string;
  source: string;
  muted: boolean;
  simulcast: boolean;
}

export interface NodeLinkErrorPayload {
  code: string;
  message: string;
}

/**
 * Error codes on the node link. Coarse on purpose. All the control plane
 * needs to decide is whether to fail this participant, retry, or write off
 * the node; finer detail belongs in the logs, not in a wire contract both
 * sides are stuck with forever.
 */
export const NodeLinkErrorCode = {
  UNKNOWN_SESSION: 'UNKNOWN_SESSION',
  ROOM_FULL: 'ROOM_FULL',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NEGOTIATION_FAILED: 'NEGOTIATION_FAILED',
  /** Retryable. The SFU already has an offer in flight. */
  NEGOTIATION_GLARE: 'NEGOTIATION_GLARE',
  INTERNAL: 'INTERNAL',
} as const;

export type NodeLinkErrorCode = (typeof NodeLinkErrorCode)[keyof typeof NodeLinkErrorCode];
