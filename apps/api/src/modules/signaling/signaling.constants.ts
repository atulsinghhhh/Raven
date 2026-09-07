// Wire protocol constants for the signaling layer. Full contract is in
// docs/rtc/signaling.md — this file is the source of truth for it.
//
// # This protocol is SFU-oriented, not peer-to-peer
//
// It replaced a full-mesh relay, in which every SDP and ICE message named
// a `targetParticipantId` and the server forwarded it between browsers.
// That shape cannot express an SFU: there is exactly one peer for every
// client (the SFU node serving their room), so a message needs no target,
// and the server is a party to the negotiation rather than a courier.
//
// The consequence worth knowing when reading old code or old docs: a
// message type whose name survived the change (`sdp.offer`, say) does not
// mean the same thing it used to. See docs/migration/from-livekit.md.

export enum ClientMessageType {
  ROOM_JOIN = 'room.join',
  ROOM_LEAVE = 'room.leave',
  /** Answering an offer the SFU sent. The common case — the SFU offers first. */
  SDP_ANSWER = 'sdp.answer',
  /** A client-initiated offer, sent when the client starts publishing. */
  SDP_OFFER = 'sdp.offer',
  ICE_CANDIDATE = 'ice.candidate',
  /** Mute/unmute a track this client publishes, without unpublishing it. */
  TRACK_MUTE = 'track.mute',
  /**
   * Declares what a track being published is *of* — camera, microphone,
   * or screen share.
   *
   * Needed because WebRTC carries no notion of source and a browser page
   * cannot choose the `MediaStream` or `MediaStreamTrack` id that ends up
   * in the SDP — both are read-only. Without this declaration the SFU can
   * only infer source from codec kind, which cannot tell a screen share
   * from a camera, and spec §16 requires that distinction.
   */
  TRACK_PUBLISH = 'track.publish',
  /** Ask for a different simulcast layer of someone else's video. */
  SUBSCRIPTION_UPDATE = 'subscription.update',
  PING = 'ping',
}

export enum ServerMessageType {
  ROOM_JOINED = 'room.joined',
  ROOM_LEFT = 'room.left',
  PARTICIPANT_JOINED = 'participant.joined',
  PARTICIPANT_LEFT = 'participant.left',
  /** Someone in the room started publishing a track. */
  TRACK_PUBLISHED = 'track.published',
  TRACK_UNPUBLISHED = 'track.unpublished',
  /**
   * A publisher muted or unmuted a track they are still publishing.
   *
   * Distinct from unpublish on purpose: the track and its transceivers
   * stay in place, so unmuting is immediate and a subscriber's UI keeps
   * the participant's tile rather than tearing it down and rebuilding it.
   */
  TRACK_MUTED = 'track.muted',
  TRACK_UNMUTED = 'track.unmuted',
  /** An offer from the SFU — on join, and again whenever the room's track set changes. */
  SDP_OFFER = 'sdp.offer',
  /** The SFU's answer to a client-initiated offer. */
  SDP_ANSWER = 'sdp.answer',
  ICE_CANDIDATE = 'ice.candidate',
  /** Real ICE/DTLS progress as the SFU observes it — not inferred from this WebSocket's health. */
  CONNECTION_STATE = 'connection.state',
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
  /** No healthy RTC server had capacity. An operator problem, not a caller one. */
  NO_RTC_CAPACITY = 'NO_RTC_CAPACITY',
  /** The assigned RTC server could not be reached. Retryable. */
  RTC_SERVER_UNREACHABLE = 'RTC_SERVER_UNREACHABLE',
  /** Negotiation failed in a way that is not retryable without rejoining. */
  NEGOTIATION_FAILED = 'NEGOTIATION_FAILED',
  /**
   * The server already has an offer in flight, so a client-initiated
   * offer cannot be applied yet. Distinct from NEGOTIATION_FAILED because
   * it *is* retryable: answer the offer already on its way, then retry.
   */
  NEGOTIATION_GLARE = 'NEGOTIATION_GLARE',
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
