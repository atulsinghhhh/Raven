import 'errors.dart';
import 'internal/engine.dart';
import 'internal/protocol.dart';
import 'internal/signaling_client.dart';
import 'internal/web_socket.dart';
import 'room.dart';

/// Raven on Flutter.
///
/// The mental model is identical to Raven Web and Raven React Native, and
/// only the syntax follows the language:
///
/// ```dart
/// final raven = Raven(token: token, endpoint: endpoint);
/// final room = await raven.join('room_123');
///
/// await room.enableCamera();
/// await room.enableMicrophone();
/// ```
///
/// Everything a developer needs comes from their own backend's
/// token-mint response. Nothing here is hand-constructed, and no Raven
/// API key ever reaches the device.
///
/// # What changed underneath
///
/// This package used to wrap `livekit_client`. It now speaks Raven's own
/// signaling protocol to Raven's own SFU, over `flutter_webrtc`. The
/// public API above is unchanged; see docs/migration/from-livekit.md for
/// the two options whose meaning shifted ([adaptiveStream] and
/// [dynacast]).
class Raven {
  Raven({
    required this.token,
    required this.endpoint,
    this.iceServers,
    this.autoReconnect = true,
    this.adaptiveStream = true,
    this.dynacast = true,
    this.region,
    this.refreshToken,
  });

  /// The RTC token your backend minted. Never mint this in the app.
  final String token;

  /// The `endpoint` field from the same mint response.
  ///
  /// This is Raven's signaling address, not a media server's. Clients
  /// never learn which SFU serves their room: that is what allows the
  /// media plane to change without an SDK release.
  final String endpoint;

  /// The `iceServers` array from the same response: forward it as-is.
  /// Omitting it means the connection has no STUN or TURN, which fails
  /// for most clients behind a NAT.
  final List<RavenIceServer>? iceServers;

  /// Defaults to true. Set false to handle reconnection yourself.
  final bool autoReconnect;

  /// Defaults to true, unlike the web SDK.
  ///
  /// Adaptive streaming asks the server for only the resolution a view is
  /// actually showing. On a phone that is the difference between decoding
  /// a 1080p stream into a thumbnail and decoding a thumbnail: a direct
  /// saving in CPU, battery and mobile data. It works here because
  /// [RavenVideoView] reports its size; the web SDK leaves it off because
  /// a browser tab has neither the battery constraint nor the metering.
  ///
  /// Implemented against Raven's own SFU by requesting a simulcast layer
  /// per view (`subscription.update`), rather than by a client library's
  /// built-in mechanism.
  final bool adaptiveStream;

  /// Retained for API compatibility, and currently a no-op.
  ///
  /// Dynacast means the *server* stops relaying simulcast layers nobody is
  /// subscribed to. Raven's SFU does not implement that yet, so setting
  /// this changes nothing today rather than silently claiming a saving
  /// that is not happening. It is kept in the constructor so existing code
  /// compiles unchanged, and it will start having an effect once the SFU
  /// gains the capability. See docs/migration/from-livekit.md.
  final bool dynacast;

  /// Preferred region for the RTC server. A preference, not a constraint:
  /// the allocator falls back to another region instead of failing a call
  /// that could otherwise happen.
  final String? region;

  /// Supplies a fresh token when the current one is rejected or a
  /// reconnect begins. Without it, a long call outlives its token and
  /// dies at the next reconnect (spec §21).
  final Future<String> Function()? refreshToken;

  RavenRoom? _room;

  /// The room currently joined, if any.
  RavenRoom? get room => _room;

  /// Joins a room.
  ///
  /// Completes once signaling has confirmed the join. Camera and
  /// microphone are **not** started automatically: a user should see
  /// their own preview and decide, and enabling them here would light up
  /// the camera before any UI explained why.
  Future<RavenRoom> join(String roomId) async {
    if (_room != null) {
      throw const RavenException(
        RavenErrorCode.connectionFailed,
        'Already connected to a room. Call leave() before joining another.',
      );
    }

    final claims = decodeTokenClaims(token);
    final tokenRoomId = claims?['rid'] as String?;
    if (tokenRoomId != null && tokenRoomId != roomId) {
      // Fails before opening a socket: clearer than letting the server
      // reject it, and it costs nothing to check.
      throw RavenException(
        RavenErrorCode.roomNotFound,
        'This token was minted for room "$tokenRoomId", not "$roomId".',
      );
    }

    final signaling = SignalingClient(
      endpoint: endpoint,
      token: token,
      roomId: roomId,
      region: region,
      autoReconnect: autoReconnect,
      refreshToken: refreshToken,
      socketFactory: ChannelSocket.connect,
    );

    final engine = RavenEngine(
      signaling: signaling,
      iceServers: (iceServers ?? const [])
          .map((server) => server.toJson())
          .toList(growable: false),
      adaptiveStream: adaptiveStream,
    );

    final JoinedPayload joined;
    try {
      joined = await signaling.connect();
    } catch (error) {
      // Dispose before rethrowing: a half-open signaling client still
      // holds a socket and a reconnect timer, and leaking one per failed
      // join is how a retry loop exhausts a device.
      await signaling.dispose();
      await engine.dispose();
      throw error is RavenException
          ? error
          : RavenException(
              RavenErrorCode.connectionFailed,
              'Could not join the room.',
              error,
            );
    }

    final room = RavenRoom.attach(
      signaling: signaling,
      engine: engine,
      roomId: roomId,
      localIdentity: claims?['sub'] as String? ?? '',
      joined: joined,
    );
    _room = room;
    return room;
  }

  /// Leaves the current room and releases everything it held.
  ///
  /// Safe to call when not in a room.
  Future<void> leave() async {
    final room = _room;
    _room = null;
    if (room == null) return;

    await room.leave();
    room.dispose();
  }
}

/// A STUN or TURN server, as returned by your backend alongside the token.
///
/// A plain data class, not a WebRTC type, so an application can
/// forward the mint response without importing `flutter_webrtc`.
class RavenIceServer {
  const RavenIceServer({
    required this.urls,
    this.username,
    this.credential,
  });

  /// Builds one from the JSON your backend returned.
  factory RavenIceServer.fromJson(Map<String, dynamic> json) => RavenIceServer(
        urls: json['urls'] as String,
        username: json['username'] as String?,
        credential: json['credential'] as String?,
      );

  final String urls;
  final String? username;
  final String? credential;

  /// @internal The shape `flutter_webrtc`'s configuration expects.
  Map<String, dynamic> toJson() => {
        'urls': urls,
        if (username != null) 'username': username,
        if (credential != null) 'credential': credential,
      };
}
