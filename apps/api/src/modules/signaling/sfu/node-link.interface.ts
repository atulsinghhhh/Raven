/**
 * The node-link wire contract, mirroring `services/sfu/internal/signal/protocol.go`.
 *
 * Two processes in two languages have to agree on this, so it is written
 * out explicitly on both sides rather than generated. If you change one,
 * change the other — there is no build step that will catch a drift, only
 * the node-link e2e test.
 *
 * `sessionId` is the control plane's own connection id, reused as the
 * session identifier on the link so a log line on either side can be
 * joined to the other without a translation table.
 */
export interface NodeLinkFrame {
  type: NodeLinkMessageType;
  sessionId?: string;
  roomId?: string;
  payload?: unknown;
  /**
   * Correlates a query with its reply.
   *
   * Separate from `sessionId` on purpose. Session-scoped frames bind a
   * session to the link they arrived on, so using a session id to
   * correlate a query would register a session that does not exist and
   * then have it swept as an orphan on the node. A query is about a room,
   * not a participant, so it gets its own identifier.
   */
  requestId?: string;
}

export enum NodeLinkMessageType {
  // --- Control plane → SFU -------------------------------------------
  PARTICIPANT_ADD = 'participant.add',
  PARTICIPANT_REMOVE = 'participant.remove',
  SDP_ANSWER = 'sdp.answer',
  /**
   * A client-initiated offer. Named distinctly from the SFU's own
   * `sdp.offer` so a frame's direction is unambiguous from its type
   * alone, rather than depending on which side read it.
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
   * Re-binds an idle session to this link. Sessions on the SFU are owned
   * by the link that created them, so an instance that reconnects its
   * link must re-claim its sessions — negotiation traffic does that on
   * its own, and this covers sessions that have none.
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

/** The SFU's copy of a participant's grant. It enforces these itself (spec §38). */
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
 * Every field is optional because a field the node has no measurement for
 * is omitted rather than zeroed — zero packet loss and "no report has
 * arrived yet" must not look the same (spec §19).
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
 * Error codes on the node link. Coarse on purpose: the control plane needs
 * to know whether to fail this participant, retry, or give up on the node,
 * and finer detail belongs in logs rather than in a wire contract both
 * sides must agree on forever.
 */
export const NodeLinkErrorCode = {
  UNKNOWN_SESSION: 'UNKNOWN_SESSION',
  ROOM_FULL: 'ROOM_FULL',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NEGOTIATION_FAILED: 'NEGOTIATION_FAILED',
  /** Retryable: the SFU already has an offer in flight. */
  NEGOTIATION_GLARE: 'NEGOTIATION_GLARE',
  INTERNAL: 'INTERNAL',
} as const;

export type NodeLinkErrorCode = (typeof NodeLinkErrorCode)[keyof typeof NodeLinkErrorCode];
