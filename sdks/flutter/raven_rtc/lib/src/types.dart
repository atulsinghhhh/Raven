import 'package:flutter_webrtc/flutter_webrtc.dart' as rtc;
import 'package:meta/meta.dart';

/// Connection lifecycle, mirroring the web SDK's `ConnectionState`.
enum RavenConnectionState {
  disconnected,
  connecting,
  connected,
  reconnecting,
  failed,
}

/// What a track carries.
///
/// `unknown` exists because the SFU can in principle report a source this
/// version doesn't know: treating that as an error would break an app on
/// a server upgrade it didn't ask for.
enum RavenTrackKind { camera, microphone, screenShare, unknown }

/// @internal Maps the wire protocol's source string onto Raven's enum.
RavenTrackKind trackKindFromSource(String source) => switch (source) {
      'camera' => RavenTrackKind.camera,
      'microphone' => RavenTrackKind.microphone,
      'screenShare' => RavenTrackKind.screenShare,
      _ => RavenTrackKind.unknown,
    };

/// @internal The renderable half of a track, as a view needs it.
@immutable
class RavenRenderableTrack {
  const RavenRenderableTrack({
    required this.trackId,
    required this.stream,
    required this.kind,
  });

  final String trackId;
  final rtc.MediaStream stream;
  final RavenTrackKind kind;
}

/// A participant in a room.
///
/// A value object built from what the SFU has reported, rather than a
/// wrapper around a client library's participant. It is a snapshot: read
/// it again after a change notification rather than holding one and
/// expecting it to update.
///
/// `identity` is the value your backend put in the token, which is the
/// only participant identifier an application should need to reason
/// about.
@immutable
class RavenParticipant {
  const RavenParticipant({
    required this.identity,
    required this.isLocal,
    this.metadata,
    Map<RavenTrackKind, RavenRenderableTrack> videoTracks = const {},
    Set<RavenTrackKind> liveSources = const {},
  })  : _videoTracks = videoTracks,
        _liveSources = liveSources;

  /// The identity your backend minted the token for.
  final String identity;

  /// True for the device this SDK is running on.
  final bool isLocal;

  /// Opaque application metadata attached when the token was minted.
  final String? metadata;

  final Map<RavenTrackKind, RavenRenderableTrack> _videoTracks;
  final Set<RavenTrackKind> _liveSources;

  /// Whether this participant is currently publishing camera video.
  ///
  /// False while muted, which is what a UI wants: a muted camera should
  /// show an avatar, not a frozen last frame.
  bool get isCameraEnabled => _liveSources.contains(RavenTrackKind.camera);

  bool get isMicrophoneEnabled =>
      _liveSources.contains(RavenTrackKind.microphone);

  bool get isScreenSharing => _liveSources.contains(RavenTrackKind.screenShare);

  /// @internal Used by [RavenVideoView] to reach the renderable track.
  /// Not part of the public API: a developer never handles a WebRTC
  /// object, and the doc comment keeps that intent explicit.
  RavenRenderableTrack? videoTrackFor(RavenTrackKind kind) =>
      _videoTracks[kind];

  @override
  bool operator ==(Object other) =>
      other is RavenParticipant && other.identity == identity;

  @override
  int get hashCode => identity.hashCode;

  @override
  String toString() => 'RavenParticipant($identity${isLocal ? ', local' : ''})';
}
