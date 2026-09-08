import { ClientMessageType, ServerMessageType, SignalingErrorCode } from '../signaling.constants';

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface RoomJoinMessage {
  type: ClientMessageType.ROOM_JOIN;
  /** Optional. If it's there, it has to match the room bound to the connection's RTC token. */
  roomId?: string;
  /**
   * Preferred region for the RTC server. A preference, not a constraint:
   * the allocator falls back to another region, not fail a call that
   * could otherwise happen. Ignored once the room already has a server
   * assigned, since everyone has to be on the same one.
   */
  region?: string;
}

export interface RoomLeaveMessage {
  type: ClientMessageType.ROOM_LEAVE;
}

/**
 * Answering the SFU's offer.
 *
 * No `targetParticipantId`. The client has exactly one peer, the SFU node
 * serving its room. That field was the defining feature of the mesh
 * protocol this replaced.
 */
export interface SdpAnswerMessage {
  type: ClientMessageType.SDP_ANSWER;
  sdp: string;
}

/** A client-initiated offer, sent when the client starts publishing. */
export interface SdpOfferMessage {
  type: ClientMessageType.SDP_OFFER;
  sdp: string;
}

export interface IceCandidateMessage {
  type: ClientMessageType.ICE_CANDIDATE;
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
}

export interface TrackMuteMessage {
  type: ClientMessageType.TRACK_MUTE;
  trackId: string;
  muted: boolean;
}

/** Declares a track's source before (or alongside) negotiating it. */
export interface TrackPublishMessage {
  type: ClientMessageType.TRACK_PUBLISH;
  trackId: string;
  source: 'camera' | 'microphone' | 'screenShare';
}

export interface SubscriptionUpdateMessage {
  type: ClientMessageType.SUBSCRIPTION_UPDATE;
  publisherId: string;
  trackId: string;
  /** `'auto'` lets the SFU choose; a named layer is a preference it honours where it can. */
  layer: 'low' | 'medium' | 'high' | 'auto';
}

export interface PingMessage {
  type: ClientMessageType.PING;
}

export type InboundSignalingMessage =
  | RoomJoinMessage
  | RoomLeaveMessage
  | SdpAnswerMessage
  | SdpOfferMessage
  | IceCandidateMessage
  | TrackMuteMessage
  | TrackPublishMessage
  | SubscriptionUpdateMessage
  | PingMessage;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

/** A track someone in the room is publishing, as the client is told about it. */
export interface PublicTrack {
  trackId: string;
  kind: 'audio' | 'video';
  /** `camera`, `microphone` or `screenShare`: what the track is *of*, which is what applications switch on. */
  source: string;
  muted: boolean;
  simulcast: boolean;
  /** Layers actually being sent, when simulcast. Empty otherwise. */
  layers?: string[];
}

export interface PublicParticipant {
  id: string;
  /**
   * What this participant is already publishing.
   *
   * Included in `room.joined` so a client joining a call in progress renders
   * the room in one pass, instead of showing an empty grid and filling it
   * in from a stream of `track.published` events it then has to tell apart
   * from genuinely new ones.
   */
  tracks?: PublicTrack[];
}

export interface RoomJoinedMessage {
  type: ServerMessageType.ROOM_JOINED;
  roomId: string;
  participants: PublicParticipant[];
  /**
   * The RTC server serving this room. Its *name*, for support and
   * diagnostics, never its address. A client that learned an SFU's address
   * could connect to it directly, and from then on the media plane couldn't
   * change without breaking that client.
   */
  rtcServer?: string;
  region?: string;
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

export interface TrackPublishedMessage {
  type: ServerMessageType.TRACK_PUBLISHED;
  participantId: string;
  track: PublicTrack;
}

export interface TrackUnpublishedMessage {
  type: ServerMessageType.TRACK_UNPUBLISHED;
  participantId: string;
  trackId: string;
}

/**
 * A publisher muted or unmuted a track they're still publishing.
 *
 * Not an unpublish. Nothing gets renegotiated, so a subscriber keeps the
 * transceiver and the tile, and unmuting resumes straight away.
 */
export interface TrackMutedMessage {
  type: ServerMessageType.TRACK_MUTED | ServerMessageType.TRACK_UNMUTED;
  participantId: string;
  trackId: string;
}

/** An offer from the SFU. The client answers it with `sdp.answer`. */
export interface SdpOfferRelayMessage {
  type: ServerMessageType.SDP_OFFER;
  sdp: string;
}

/** The SFU's answer to a client-initiated offer. */
export interface SdpAnswerRelayMessage {
  type: ServerMessageType.SDP_ANSWER;
  sdp: string;
}

export interface IceCandidateRelayMessage {
  type: ServerMessageType.ICE_CANDIDATE;
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
}

/**
 * ICE and DTLS state, as the SFU sees it.
 *
 * Worth having alongside what the client sees locally. The two sides of a
 * connection can disagree about whether it's up, and "the SFU says failed
 * while the browser says connected" is precisely what a support engineer
 * needs to know.
 */
export interface ConnectionStateMessage {
  type: ServerMessageType.CONNECTION_STATE;
  iceState: string;
  peerState: string;
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
  | TrackPublishedMessage
  | TrackUnpublishedMessage
  | TrackMutedMessage
  | SdpOfferRelayMessage
  | SdpAnswerRelayMessage
  | IceCandidateRelayMessage
  | ConnectionStateMessage
  | ErrorMessage
  | PongMessage;
