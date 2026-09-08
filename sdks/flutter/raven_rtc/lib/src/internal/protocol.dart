/// Raven's signaling wire protocol, as the Flutter client sees it.
///
/// Mirrors `packages/sdk/src/internal/signaling/protocol.ts` and
/// `apps/api/src/modules/signaling/signaling.constants.ts`. Written out
/// here rather than generated: three client implementations (web, React
/// Native, Flutter) speak this, and the contract has to be readable on its
/// own in each language.
///
/// If you change a message here, change it in the other two and in the
/// server. Nothing at build time will catch a drift — only the
/// integration tests will.
library;

import 'dart:convert';

/// Messages this client sends.
abstract final class ClientMessageType {
  static const roomJoin = 'room.join';
  static const roomLeave = 'room.leave';
  static const sdpAnswer = 'sdp.answer';
  static const sdpOffer = 'sdp.offer';
  static const iceCandidate = 'ice.candidate';
  static const trackMute = 'track.mute';

  /// Declares what a track being published is *of*.
  ///
  /// WebRTC carries no notion of source, and an application cannot choose
  /// the media-stream or track id that ends up in the SDP. Without this
  /// the server could only infer source from codec kind, which cannot
  /// tell a screen share from a camera.
  static const trackPublish = 'track.publish';
  static const subscriptionUpdate = 'subscription.update';
  static const ping = 'ping';
}

/// Messages the server sends.
abstract final class ServerMessageType {
  static const roomJoined = 'room.joined';
  static const roomLeft = 'room.left';
  static const participantJoined = 'participant.joined';
  static const participantLeft = 'participant.left';
  static const trackPublished = 'track.published';
  static const trackUnpublished = 'track.unpublished';
  static const trackMuted = 'track.muted';
  static const trackUnmuted = 'track.unmuted';
  static const sdpOffer = 'sdp.offer';
  static const sdpAnswer = 'sdp.answer';
  static const iceCandidate = 'ice.candidate';
  static const connectionState = 'connection.state';
  static const error = 'error';
  static const pong = 'pong';
}

/// Signaling error codes, as the server names them.
abstract final class SignalingErrorCode {
  static const invalidToken = 'INVALID_TOKEN';
  static const tokenExpired = 'TOKEN_EXPIRED';
  static const unauthorized = 'UNAUTHORIZED';
  static const roomNotFound = 'ROOM_NOT_FOUND';
  static const roomFull = 'ROOM_FULL';
  static const permissionDenied = 'PERMISSION_DENIED';
  static const rateLimited = 'RATE_LIMITED';
  static const noRtcCapacity = 'NO_RTC_CAPACITY';
  static const rtcServerUnreachable = 'RTC_SERVER_UNREACHABLE';
  static const negotiationFailed = 'NEGOTIATION_FAILED';
  static const negotiationGlare = 'NEGOTIATION_GLARE';

  /// Codes that mean the credential itself is the problem, so reconnecting
  /// with the same token cannot help.
  ///
  /// The distinction drives reconnect behaviour: everything else is worth
  /// retrying with backoff, these need a fresh token from the
  /// application's backend first.
  static const fatal = <String>{
    invalidToken,
    tokenExpired,
    unauthorized,
    roomNotFound,
    permissionDenied,
  };
}

/// A track the server says someone is publishing.
class ServerTrack {
  const ServerTrack({
    required this.trackId,
    required this.kind,
    required this.source,
    required this.muted,
    required this.simulcast,
    this.layers = const [],
  });

  factory ServerTrack.fromJson(Map<String, dynamic> json) => ServerTrack(
        trackId: json['trackId'] as String? ?? '',
        kind: json['kind'] as String? ?? 'video',
        source: json['source'] as String? ?? 'unknown',
        muted: json['muted'] as bool? ?? false,
        simulcast: json['simulcast'] as bool? ?? false,
        layers: (json['layers'] as List<dynamic>?)
                ?.map((layer) => layer as String)
                .toList(growable: false) ??
            const [],
      );

  final String trackId;

  /// `'audio'` or `'video'` — the codec kind, not the source.
  final String kind;

  /// `'camera'`, `'microphone'`, `'screenShare'`, or something this
  /// version does not know about.
  final String source;
  final bool muted;
  final bool simulcast;

  /// Layers actually being sent, when simulcast. Empty otherwise.
  final List<String> layers;
}

/// A participant the server says is in the room.
class ServerParticipant {
  const ServerParticipant({required this.id, this.tracks = const []});

  factory ServerParticipant.fromJson(Map<String, dynamic> json) =>
      ServerParticipant(
        id: json['id'] as String? ?? '',
        tracks: (json['tracks'] as List<dynamic>?)
                ?.map((track) =>
                    ServerTrack.fromJson(track as Map<String, dynamic>))
                .toList(growable: false) ??
            const [],
      );

  final String id;

  /// What this participant is already publishing.
  ///
  /// Present in `room.joined` so a client joining a call in progress can
  /// render the room in one pass, rather than showing an empty grid and
  /// filling it in from a stream of events it has to distinguish from
  /// genuinely new ones.
  final List<ServerTrack> tracks;
}

/// What the server reports at the moment of joining.
class JoinedPayload {
  const JoinedPayload({
    required this.roomId,
    required this.participants,
    this.rtcServer,
    this.region,
  });

  factory JoinedPayload.fromJson(Map<String, dynamic> json) => JoinedPayload(
        roomId: json['roomId'] as String? ?? '',
        participants: (json['participants'] as List<dynamic>?)
                ?.map((participant) => ServerParticipant.fromJson(
                    participant as Map<String, dynamic>))
                .toList(growable: false) ??
            const [],
        rtcServer: json['rtcServer'] as String?,
        region: json['region'] as String?,
      );

  final String roomId;
  final List<ServerParticipant> participants;

  /// The RTC server's *name*, for diagnostics. Never its address — a
  /// client that learned an SFU's address could connect to it directly,
  /// and then the media plane could not be changed without breaking that
  /// client.
  final String? rtcServer;
  final String? region;
}

/// An ICE candidate, in the shape both directions of the protocol use.
class IceCandidatePayload {
  const IceCandidatePayload({
    required this.candidate,
    this.sdpMid,
    this.sdpMLineIndex,
    this.usernameFragment,
  });

  factory IceCandidatePayload.fromJson(Map<String, dynamic> json) =>
      IceCandidatePayload(
        candidate: json['candidate'] as String? ?? '',
        sdpMid: json['sdpMid'] as String?,
        sdpMLineIndex: json['sdpMLineIndex'] as int?,
        usernameFragment: json['usernameFragment'] as String?,
      );

  final String candidate;
  final String? sdpMid;
  final int? sdpMLineIndex;
  final String? usernameFragment;

  Map<String, dynamic> toJson() => {
        'type': ClientMessageType.iceCandidate,
        'candidate': candidate,
        if (sdpMid != null) 'sdpMid': sdpMid,
        if (sdpMLineIndex != null) 'sdpMLineIndex': sdpMLineIndex,
        if (usernameFragment != null) 'usernameFragment': usernameFragment,
      };
}

/// Reads the claims out of a Raven RTC token.
///
/// The payload is readable, not secret — the same information the server
/// will act on. It is decoded, never trusted: the server re-verifies the
/// signature, so anything a client changed here only changes which room it
/// *asks* for.
Map<String, dynamic>? decodeTokenClaims(String token) {
  final parts = token.split('.');
  if (parts.length != 3) return null;

  try {
    // base64Url tolerates the unpadded form the JWT spec mandates, so no
    // padding fix-up is needed — unlike plain `base64`, which throws.
    final decoded =
        utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
    final parsed = jsonDecode(decoded);
    return parsed is Map<String, dynamic> ? parsed : null;
  } catch (_) {
    return null;
  }
}
