import 'package:livekit_client/livekit_client.dart' as lk;

import 'errors.dart';
import 'room.dart';

/// Raven on Flutter.
///
/// The mental model is identical to Raven Web and Raven React Native, and
/// only the syntax follows the language (spec §10):
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
/// API key ever reaches the device (spec §15).
class Raven {
  Raven({
    required this.token,
    required this.endpoint,
    this.iceServers,
    this.autoReconnect = true,
    this.adaptiveStream = true,
    this.dynacast = true,
  });

  /// The RTC token your backend minted. Never mint this in the app.
  final String token;

  /// The `endpoint` field from the same mint response.
  final String endpoint;

  /// The `iceServers` array from the same response — forward it as-is.
  /// Omitting it means STUN/TURN comes from the server's own defaults,
  /// which is usually wrong for clients behind restrictive NATs.
  final List<RavenIceServer>? iceServers;

  /// Defaults to true. Set false to handle reconnection yourself.
  final bool autoReconnect;

  /// Defaults to true, unlike the web SDK.
  ///
  /// Adaptive streaming asks the server for only the resolution a view is
  /// actually showing. On a phone that is the difference between decoding
  /// a 1080p stream into a thumbnail and decoding a thumbnail — it is a
  /// direct saving in CPU, battery and mobile data (spec §19). It works
  /// here because [RavenVideoView] reports its size to the renderer;
  /// the web SDK leaves it off because a browser tab has neither the
  /// battery constraint nor the same metering.
  final bool adaptiveStream;

  /// Defaults to true. Stops publishing layers nobody is subscribed to,
  /// which saves upload bandwidth on a metered connection.
  final bool dynacast;

  RavenRoom? _room;

  /// The room currently joined, if any.
  RavenRoom? get room => _room;

  /// Joins a room.
  ///
  /// Resolves once the connection is established. Camera and microphone
  /// are **not** started automatically — a user should see their own
  /// preview and decide, and enabling them here would light up the camera
  /// before any UI explained why.
  Future<RavenRoom> join(String roomId) async {
    if (_room != null) {
      throw const RavenException(
        RavenErrorCode.connectionFailed,
        'Already connected to a room. Call leave() before joining another.',
      );
    }

    final lkRoom = lk.Room(
      roomOptions: lk.RoomOptions(
        adaptiveStream: adaptiveStream,
        dynacast: dynacast,
      ),
    );

    try {
      await lkRoom.connect(
        endpoint,
        token,
        connectOptions: lk.ConnectOptions(
          autoSubscribe: true,
          rtcConfiguration: iceServers == null
              ? null
              : lk.RTCConfiguration(
                  iceServers: iceServers!
                      .map((server) => lk.RTCIceServer(
                            urls: [server.urls],
                            username: server.username,
                            credential: server.credential,
                          ))
                      .toList(growable: false),
                ),
        ),
      );
    } catch (error) {
      // Dispose before rethrowing: a half-connected Room still holds
      // native peer-connection resources, and leaking one per failed
      // join is how a retry loop exhausts a device.
      await lkRoom.dispose();
      throw _translateConnectError(error);
    }

    final room = RavenRoom.attach(lkRoom, roomId);
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
/// A plain data class rather than the SFU's own type, so an application
/// can forward the mint response without importing livekit_client.
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
}

RavenException _translateConnectError(Object error) {
  if (error is RavenException) return error;

  final text = error.toString().toLowerCase();

  // Ordered most-specific first: an expired token also mentions
  // "unauthorized" on some server versions, and reporting it as a generic
  // auth failure would hide the one thing a developer can act on.
  if (text.contains('expired')) {
    return RavenException(
      RavenErrorCode.tokenExpired,
      'The RTC token has expired. Mint a fresh one — Raven tokens are always short-lived.',
      error,
    );
  }
  if (text.contains('unauthorized') ||
      text.contains('401') ||
      text.contains('invalid token')) {
    return RavenException(
      RavenErrorCode.invalidToken,
      'The RTC token was rejected.',
      error,
    );
  }
  if (text.contains('timeout') || text.contains('timed out')) {
    return RavenException(
      RavenErrorCode.timeout,
      'Timed out connecting to the room.',
      error,
    );
  }
  if (text.contains('network') || text.contains('unreachable')) {
    return RavenException(
      RavenErrorCode.networkError,
      'Could not reach the Raven media server.',
      error,
    );
  }

  return RavenException(
    RavenErrorCode.connectionFailed,
    'Could not join the room.',
    error,
  );
}
