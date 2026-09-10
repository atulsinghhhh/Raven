// Wire protocol constants for the signaling layer. The full contract lives
// in docs/rtc/signaling.md, and this file is the source of truth behind it.
//
// # This protocol is SFU-oriented, not peer-to-peer
//
// It replaced a full-mesh relay, where every SDP and ICE message named a
// `targetParticipantId` and the server shuttled it between browsers. That
// shape simply can't express an SFU. Every client has exactly one peer, the
// SFU node serving their room, so a message needs no target at all, and the
// server is a party to the negotiation, not a courier.
//
// The consequence, and it's worth knowing before reading old code or old
// docs: a message type whose *name* survived the change, `sdp.offer` say,
// does not mean what it used to. See docs/migration/from-livekit.md.

export enum ClientMessageType {
  ROOM_JOIN = 'room.join',
  ROOM_LEAVE = 'room.leave',
  /** Answering an offer the SFU sent. The common case, since the SFU offers first. */
  SDP_ANSWER = 'sdp.answer',
  /** A client-initiated offer, sent when the client starts publishing. */
  SDP_OFFER = 'sdp.offer',
  ICE_CANDIDATE = 'ice.candidate',
  /** Mute/unmute a track this client publishes, without unpublishing it. */
  TRACK_MUTE = 'track.mute',
  /**
   * Declares what a track being published is *of*: camera, microphone, or
   * screen share.
   *
   * Needed because WebRTC has no notion of a source, and a browser page
   * can't choose the `MediaStream` or `MediaStreamTrack` id that lands in
   * the SDP; both are read-only. Without this declaration the SFU can only
   * guess the source from codec kind, and that can't tell a screen share
   * from a camera. Spec §16 requires the distinction.
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
   * A publisher muted or unmuted a track they're still publishing.
   *
   * Kept distinct from unpublish on purpose. The track and its transceivers
   * stay put, so unmuting is instant and a subscriber's UI keeps the
   * participant's tile instead of tearing it down and rebuilding it.
   */
  TRACK_MUTED = 'track.muted',
  TRACK_UNMUTED = 'track.unmuted',
  /** An offer from the SFU. Sent on join, and again whenever the room's track set changes. */
  SDP_OFFER = 'sdp.offer',
  /** The SFU's answer to a client-initiated offer. */
  SDP_ANSWER = 'sdp.answer',
  ICE_CANDIDATE = 'ice.candidate',
  /** Real ICE and DTLS progress, as the SFU sees it. Not inferred from this WebSocket's health. */
  CONNECTION_STATE = 'connection.state',
  ERROR = 'error',
  PONG = 'pong',
}

export enum SignalingErrorCode {
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  /**
   * The token was revoked before it expired. Terminal, and kept apart from
   * both INVALID_TOKEN and TOKEN_EXPIRED because the remedy differs: the
   * signature was ours and the clock was fine, someone deliberately killed
   * this credential. A client should ask its backend for a new one rather
   * than retry, and a developer seeing this in logs should be looking for
   * whoever called revoke, not for a clock skew or a secret mismatch.
   */
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_FULL = 'ROOM_FULL',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  INVALID_MESSAGE_TYPE = 'INVALID_MESSAGE_TYPE',
  PARTICIPANT_NOT_FOUND = 'PARTICIPANT_NOT_FOUND',
  NOT_IN_ROOM = 'NOT_IN_ROOM',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  /**
   * The page's `Origin` is not on this project's allow-list. Terminal for
   * this connection and not something the client can retry its way out of:
   * the fix is in the dashboard, under Project Settings, Security, Allowed
   * Origins. Kept apart from UNAUTHORIZED because the token was perfectly
   * valid — it was the page holding it that was not expected.
   */
  ORIGIN_NOT_ALLOWED = 'ORIGIN_NOT_ALLOWED',
  RATE_LIMITED = 'RATE_LIMITED',
  /**
   * The developer account behind this project has spent its included Raven
   * minutes. Terminal for this join: unlike RATE_LIMITED there is nothing
   * to wait for, and unlike NO_RTC_CAPACITY it is not an operator problem.
   * Sessions already in progress are never cut off by it.
   */
  USAGE_LIMIT_EXCEEDED = 'USAGE_LIMIT_EXCEEDED',
  /** No healthy RTC server had capacity. An operator problem, not a caller one. */
  NO_RTC_CAPACITY = 'NO_RTC_CAPACITY',
  /** The assigned RTC server could not be reached. Retryable. */
  RTC_SERVER_UNREACHABLE = 'RTC_SERVER_UNREACHABLE',
  /** Negotiation failed in a way that is not retryable without rejoining. */
  NEGOTIATION_FAILED = 'NEGOTIATION_FAILED',
  /**
   * The server already has an offer in flight, so a client-initiated offer
   * can't be applied yet. Kept apart from NEGOTIATION_FAILED because this
   * one *is* retryable: answer the offer already on its way, then retry.
   */
  NEGOTIATION_GLARE = 'NEGOTIATION_GLARE',
}

// Not in .env on purpose. These are wire-protocol and operational
// constants, not per-deployment config. The things that genuinely vary by
// deployment, max participants and message rate, live under `signaling` in
// configuration.ts instead.
export const SIGNALING_PATH = '/v1/rtc';
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 60_000; // one missed cycle before termination

/**
 * Redis key namespace for fleet-wide room state, following
 * chat.constants.ts's `RedisKeys` convention.
 *
 * Every key here carries a TTL, same reasoning as chat's presence and
 * connection keys, so a gateway dying mid-heartbeat doesn't leave phantom
 * participants lying about.
 */
export const SignalingRedisKeys = {
  /** Set of participantIds currently in the room, fleet-wide. */
  roomParticipants: (roomId: string) => `raven:signaling:room:${roomId}:participants`,
  /** participantId -> {gatewayId}. Lets any instance find who's holding a target's socket. */
  participant: (roomId: string, participantId: string) =>
    `raven:signaling:room:${roomId}:participant:${participantId}`,
  /** Pub/sub channel for this room, one per room, subscribed to on demand. */
  roomChannel: (roomId: string) => `raven:signaling:room:${roomId}:events`,
} as const;

/**
 * Outlives one full missed heartbeat cycle plus a safety margin. So a
 * gateway dying mid-cycle doesn't leave a fleet-wide phantom participant
 * hanging around much longer than the local heartbeat sweep would take to
 * clear a live one.
 */
export const SIGNALING_PARTICIPANT_TTL_SECONDS = Math.ceil((HEARTBEAT_TIMEOUT_MS * 2) / 1000);
