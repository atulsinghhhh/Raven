import 'package:livekit_client/livekit_client.dart' as lk;

/// Connection lifecycle, mirroring the web SDK's `ConnectionState`.
enum RavenConnectionState {
  disconnected,
  connecting,
  connected,
  reconnecting,
  failed,
}

/// What a track carries. `unknown` exists because the SFU can in
/// principle report a source this version doesn't know — treating that as
/// an error would break an app on a server upgrade it didn't ask for.
enum RavenTrackKind { camera, microphone, screenShare, unknown }

/// A participant in a room.
///
/// Wraps the SFU's participant rather than exposing it. `identity` is the
/// value your backend put in the token, which is the only participant
/// identifier an application should need to reason about.
class RavenParticipant {
  RavenParticipant._(this._participant, {required this.isLocal});

  final lk.Participant _participant;

  /// True for the device this SDK is running on.
  final bool isLocal;

  /// The identity your backend minted the token for.
  String get identity => _participant.identity;

  /// Opaque application metadata attached when the token was minted.
  String? get metadata =>
      _participant.metadata?.isEmpty ?? true ? null : _participant.metadata;

  /// Whether this participant is currently publishing camera video.
  ///
  /// False while muted, which is what a UI wants: a muted camera should
  /// show an avatar, not a frozen last frame.
  bool get isCameraEnabled => _hasLiveTrack(lk.TrackSource.camera);

  bool get isMicrophoneEnabled => _hasLiveTrack(lk.TrackSource.microphone);

  bool get isScreenSharing => _hasLiveTrack(lk.TrackSource.screenShareVideo);

  bool _hasLiveTrack(lk.TrackSource source) {
    for (final publication in _participant.trackPublications.values) {
      if (publication.source == source) {
        return !publication.muted && publication.track != null;
      }
    }
    return false;
  }

  /// @internal Used by [RavenVideoView] to reach the renderable track.
  /// Not part of the public API — a developer never handles a LiveKit
  /// object, and the underscore keeps it out of their autocomplete.
  lk.VideoTrack? videoTrackFor(RavenTrackKind kind) {
    final source = kind == RavenTrackKind.screenShare
        ? lk.TrackSource.screenShareVideo
        : lk.TrackSource.camera;

    for (final publication in _participant.trackPublications.values) {
      if (publication.source == source && !publication.muted) {
        final track = publication.track;
        if (track is lk.VideoTrack) {
          return track;
        }
      }
    }
    return null;
  }

  /// @internal
  static RavenParticipant wrap(lk.Participant participant,
          {required bool isLocal}) =>
      RavenParticipant._(participant, isLocal: isLocal);

  @override
  bool operator ==(Object other) =>
      other is RavenParticipant && other.identity == identity;

  @override
  int get hashCode => identity.hashCode;

  @override
  String toString() => 'RavenParticipant($identity${isLocal ? ', local' : ''})';
}

/// @internal Maps the SFU's connection state onto Raven's.
RavenConnectionState mapConnectionState(lk.ConnectionState state) {
  switch (state) {
    case lk.ConnectionState.disconnected:
      return RavenConnectionState.disconnected;
    case lk.ConnectionState.connecting:
      return RavenConnectionState.connecting;
    case lk.ConnectionState.connected:
      return RavenConnectionState.connected;
    case lk.ConnectionState.reconnecting:
      return RavenConnectionState.reconnecting;
  }
}
