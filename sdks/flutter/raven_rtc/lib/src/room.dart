import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' as rtc;

import 'errors.dart';
import 'internal/engine.dart';
import 'internal/protocol.dart';
import 'internal/signaling_client.dart';
import 'types.dart';

/// Default capture constraints.
///
/// `ideal`, never `exact`: an exact resolution fails outright on a device
/// that cannot provide it, and "the call did not start because your front
/// camera is 640×480" is not an acceptable outcome.
const _cameraConstraints = <String, dynamic>{
  'width': {'ideal': 1280},
  'height': {'ideal': 720},
  'frameRate': {'ideal': 30},
  'facingMode': 'user',
};

/// All three are on by default because a call without them sounds bad in
/// the situations calls actually happen in: a phone speaker and mic in
/// the same room is an echo generator.
const _microphoneConstraints = <String, dynamic>{
  'echoCancellation': true,
  'noiseSuppression': true,
  'autoGainControl': true,
};

/// A joined room.
///
/// Returned by `Raven.join()`: never constructed directly. Owns the
/// participant roster and every room-scoped action. No SDP, ICE
/// candidate, or peer connection reaches this API.
///
/// Extends [ChangeNotifier], which is the idiomatic Flutter way to expose
/// changing state: an `AnimatedBuilder`, `ListenableBuilder` or
/// `provider` can rebuild from it directly. This is where the Flutter SDK
/// diverges from the TypeScript one by design: the web SDK's
/// `room.on('event', handler)` would work in Dart but would feel foreign.
/// The *concepts* are identical; only the subscription mechanism follows
/// the platform.
///
/// Typed streams are available too, for logic that belongs outside the
/// widget tree.
class RavenRoom extends ChangeNotifier {
  RavenRoom._({
    required SignalingClient signaling,
    required RavenEngine engine,
    required this.roomId,
    required String localIdentity,
    required String? localMetadata,
  })  : _signaling = signaling,
        _engine = engine,
        _localIdentity = localIdentity,
        _localMetadata = localMetadata {
    _wire();
  }

  /// @internal
  static RavenRoom attach({
    required SignalingClient signaling,
    required RavenEngine engine,
    required String roomId,
    required String localIdentity,
    String? localMetadata,
    required JoinedPayload joined,
  }) {
    final room = RavenRoom._(
      signaling: signaling,
      engine: engine,
      roomId: roomId,
      localIdentity: localIdentity,
      localMetadata: localMetadata,
    );
    room._applyJoined(joined);
    engine.start();
    return room;
  }

  final SignalingClient _signaling;
  final RavenEngine _engine;

  /// The room this connection was established for.
  final String roomId;

  final String _localIdentity;
  final String? _localMetadata;

  final _connectionStateController =
      StreamController<RavenConnectionState>.broadcast();
  final _participantsController =
      StreamController<List<RavenParticipant>>.broadcast();
  final _errorController = StreamController<RavenException>.broadcast();
  final _dataController = StreamController<List<int>>.broadcast();

  final _subscriptions = <StreamSubscription<Object?>>[];

  /// Identities the server has reported, in join order.
  final _remoteIdentities = <String>[];

  RavenConnectionState _connectionState = RavenConnectionState.connected;
  String? _rtcServer;
  String? _region;
  bool _disposed = false;

  /// Connection state changes. Also reflected by [connectionState] and by
  /// [ChangeNotifier] notifications.
  Stream<RavenConnectionState> get connectionStateChanges =>
      _connectionStateController.stream;

  /// Fires whenever the roster or anyone's published tracks change.
  Stream<List<RavenParticipant>> get participantChanges =>
      _participantsController.stream;

  /// Errors that arrive asynchronously rather than from a call you made;
  /// a reconnect giving up, for instance.
  Stream<RavenException> get errors => _errorController.stream;

  /// Payloads other participants sent with [sendData].
  ///
  /// No sender is attributed: the SFU fans data out on each recipient's
  /// own channel, so the transport carries no sender identity. Put the
  /// sender in your own payload if you need it, and remember it is then
  /// a claim, not a fact.
  Stream<List<int>> get data => _dataController.stream;

  RavenConnectionState get connectionState => _connectionState;

  /// The RTC server serving this room, by name. For support and
  /// diagnostics; never an address.
  String? get rtcServer => _rtcServer;

  /// The region the room was allocated in.
  String? get region => _region;

  /// This device's participant.
  RavenParticipant get localParticipant {
    final videoTracks = <RavenTrackKind, RavenRenderableTrack>{};
    final live = <RavenTrackKind>{};

    for (final published in _engine.publishedTracks) {
      final kind = trackKindFromSource(published.source);
      if (!published.muted) {
        live.add(kind);
      }
      if (kind != RavenTrackKind.microphone && !published.muted) {
        videoTracks[kind] = RavenRenderableTrack(
          trackId: published.track.id ?? '',
          stream: published.stream,
          kind: kind,
        );
      }
    }

    return RavenParticipant(
      identity: _localIdentity,
      isLocal: true,
      metadata: _localMetadata,
      videoTracks: videoTracks,
      liveSources: live,
    );
  }

  /// Everyone else currently in the room.
  List<RavenParticipant> get remoteParticipants =>
      _remoteIdentities.map(_buildRemoteParticipant).toList(growable: false);

  /// Local participant first, then remotes: the order a grid renders in.
  List<RavenParticipant> get participants =>
      [localParticipant, ...remoteParticipants];

  RavenParticipant _buildRemoteParticipant(String identity) {
    final videoTracks = <RavenTrackKind, RavenRenderableTrack>{};
    final live = <RavenTrackKind>{};

    for (final subscription in _engine.subscribedTracks) {
      if (subscription.participantId != identity) continue;
      final kind = trackKindFromSource(subscription.source);
      if (subscription.muted) continue;

      live.add(kind);
      if (kind != RavenTrackKind.microphone) {
        videoTracks[kind] = RavenRenderableTrack(
          trackId: subscription.trackId,
          stream: subscription.stream,
          kind: kind,
        );
      }
    }

    return RavenParticipant(
      identity: identity,
      isLocal: false,
      videoTracks: videoTracks,
      liveSources: live,
    );
  }

  // ---------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------

  /// Captures and publishes the camera.
  ///
  /// Throws [RavenPermissionException] when the OS refuses access, rather
  /// than resolving to a silent black frame.
  Future<void> enableCamera() async {
    final existing = _engine.publishedTrack('camera');
    if (existing != null) {
      // Already publishing: unmute instead of capture again. A second
      // capture of the same device is slower and, on some platforms,
      // fails outright.
      await _engine.setMuted('camera', false);
      _emitParticipants();
      return;
    }

    await _guardMedia(RavenPermission.camera, () async {
      final stream = await rtc.navigator.mediaDevices
          .getUserMedia({'video': _cameraConstraints, 'audio': false});
      final track = stream.getVideoTracks().first;
      await _engine.publish(source: 'camera', stream: stream, track: track);
    });
    _emitParticipants();
  }

  /// Stops publishing and releases the camera.
  Future<void> disableCamera() async {
    await _guardMedia(
      RavenPermission.camera,
      () => _engine.unpublish('camera'),
    );
    _emitParticipants();
  }

  Future<void> enableMicrophone() async {
    final existing = _engine.publishedTrack('microphone');
    if (existing != null) {
      await _engine.setMuted('microphone', false);
      _emitParticipants();
      return;
    }

    await _guardMedia(RavenPermission.microphone, () async {
      // Video explicitly false: spec §13 requires that an audio-only call
      // never asks for camera permission.
      final stream = await rtc.navigator.mediaDevices
          .getUserMedia({'audio': _microphoneConstraints, 'video': false});
      final track = stream.getAudioTracks().first;
      await _engine.publish(source: 'microphone', stream: stream, track: track);
    });
    _emitParticipants();
  }

  Future<void> disableMicrophone() async {
    await _guardMedia(
      RavenPermission.microphone,
      () => _engine.unpublish('microphone'),
    );
    _emitParticipants();
  }

  /// Mutes the microphone without unpublishing it.
  ///
  /// Preferable to `disableMicrophone()` for a mute button: the track
  /// stays published, so unmuting is instant and other participants keep
  /// the tile, not seeing it disappear and come back.
  Future<void> setMicrophoneMuted(bool muted) async {
    await _engine.setMuted('microphone', muted);
    _emitParticipants();
  }

  /// Mutes the camera without unpublishing it. See [setMicrophoneMuted].
  Future<void> setCameraMuted(bool muted) async {
    await _engine.setMuted('camera', muted);
    _emitParticipants();
  }

  /// Starts screen sharing.
  ///
  /// Both platforms show a system consent dialog first, and both can have
  /// it dismissed: that surfaces as a [RavenException], not a silent
  /// no-op. On iOS this additionally requires a Broadcast Upload
  /// Extension in the host app; see docs/sdk/flutter.md#screen-sharing.
  Future<void> enableScreenShare() async {
    await _guardMedia(RavenPermission.camera, () async {
      final stream = await rtc.navigator.mediaDevices
          .getDisplayMedia({'video': true, 'audio': false});
      final tracks = stream.getVideoTracks();
      if (tracks.isEmpty) {
        throw const RavenException(
          RavenErrorCode.mediaError,
          'Screen capture returned no video track.',
        );
      }
      await _engine.publish(
          source: 'screenShare', stream: stream, track: tracks.first);
    });
    _emitParticipants();
  }

  Future<void> disableScreenShare() async {
    await _guardMedia(
      RavenPermission.camera,
      () => _engine.unpublish('screenShare'),
    );
    _emitParticipants();
  }

  /// Switches between the front and rear camera.
  ///
  /// A phone-only concern with no web equivalent, and common enough to
  /// deserve a first-class method rather than device enumeration.
  ///
  /// Uses the platform's in-place switch where available, which keeps the
  /// same track and sender, so nobody else in the room observes anything.
  Future<void> switchCamera() async {
    final published = _engine.publishedTrack('camera');
    if (published == null) {
      throw const RavenException(
        RavenErrorCode.deviceNotFound,
        'No camera is currently publishing — call enableCamera() first.',
      );
    }

    try {
      await rtc.Helper.switchCamera(published.track);
    } catch (error) {
      throw RavenException(
        RavenErrorCode.mediaError,
        'Could not switch camera.',
        error,
      );
    }
    _emitParticipants();
  }

  /// Sends a payload to everyone else in the room over the data channel.
  ///
  /// Rides WebRTC instead of the signaling socket, so it gets the same
  /// NAT traversal and encryption as media and does not compete with
  /// negotiation for the control connection (spec §18).
  Future<void> sendData(List<int> payload) async {
    try {
      await _engine.sendData(payload);
    } catch (error) {
      if (error is RavenException) rethrow;
      throw RavenException(
        RavenErrorCode.mediaError,
        'Could not send data.',
        error,
      );
    }
  }

  /// Asks the SFU for a specific simulcast layer of a subscribed track.
  ///
  /// A preference, not a command: the SFU will not hand over a layer the
  /// publisher is not sending. [RavenVideoView] calls this on your behalf
  /// when `adaptiveStream` is on.
  void requestLayer(
    RavenParticipant participant,
    RavenTrackKind kind,
    String layer,
  ) {
    final track = participant.videoTrackFor(kind);
    if (track == null) return;
    _engine.requestLayer(participant.identity, track.trackId, layer);
  }

  /// Leaves the room and releases all local media.
  Future<void> leave() async {
    try {
      await _signaling.close();
    } catch (_) {
      // Already gone. Leaving is the one operation that must never throw:
      // an app tearing a screen down has nothing useful to do with the
      // failure, and rethrowing here strands the UI.
    }
    _setConnectionState(RavenConnectionState.disconnected);
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;

    // Order matters. Cancel subscriptions before closing the controllers,
    // or a late event tries to add to a closed stream and throws from a
    // zone the app cannot catch.
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    _subscriptions.clear();

    _connectionStateController.close();
    _participantsController.close();
    _errorController.close();
    _dataController.close();

    // Both teardowns are async and ChangeNotifier.dispose() is not, so
    // they are explicitly unawaited, not silently dropped: the
    // teardown is fire-and-forget by design, and saying so keeps the
    // unawaited_futures lint meaningful everywhere else.
    unawaited(_engine.dispose());
    unawaited(_signaling.dispose());
    super.dispose();
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  void _wire() {
    _subscriptions.add(_engine.changes.listen((_) => _emitParticipants()));
    _subscriptions.add(_engine.errors.listen(_emitError));
    _subscriptions.add(_engine.data.listen((payload) {
      if (!_disposed) _dataController.add(payload);
    }));

    _subscriptions.add(_signaling.messages.listen((message) {
      switch (message['type']) {
        case ServerMessageType.participantJoined:
          final participant = message['participant'] as Map<String, dynamic>?;
          final identity = participant?['id'] as String?;
          if (identity != null && !_remoteIdentities.contains(identity)) {
            _remoteIdentities.add(identity);
            _emitParticipants();
          }
        case ServerMessageType.participantLeft:
          final participant = message['participant'] as Map<String, dynamic>?;
          final identity = participant?['id'] as String?;
          if (identity != null && _remoteIdentities.remove(identity)) {
            _emitParticipants();
          }
      }
    }));

    _subscriptions.add(_signaling.joins.listen((payload) {
      // A reconnect re-runs the join, so the reported roster is
      // authoritative. Replacing rather than merging is what stops a
      // participant who left during an outage from lingering.
      _applyJoined(payload);
      _engine.applyJoinedState(payload);
      _setConnectionState(RavenConnectionState.connected);
      _emitParticipants();
    }));

    _subscriptions.add(_signaling.lifecycle.listen((state) {
      switch (state) {
        case SignalingReconnecting():
          _setConnectionState(RavenConnectionState.reconnecting);
          // The old peer connection is not reusable: the server
          // allocates a fresh session on rejoin.
          unawaited(_engine.resetPeerConnection());
        case SignalingClosed():
          _setConnectionState(RavenConnectionState.disconnected);
        case SignalingFailed(:final error):
          _setConnectionState(RavenConnectionState.failed);
          _emitError(error);
      }
    }));
  }

  void _applyJoined(JoinedPayload payload) {
    _rtcServer = payload.rtcServer;
    _region = payload.region;
    _remoteIdentities
      ..clear()
      ..addAll(payload.participants.map((participant) => participant.id));
  }

  void _setConnectionState(RavenConnectionState next) {
    if (_disposed || _connectionState == next) return;
    _connectionState = next;
    _connectionStateController.add(next);
    notifyListeners();
  }

  void _emitParticipants() {
    if (_disposed) return;
    _participantsController.add(participants);
    notifyListeners();
  }

  void _emitError(RavenException error) {
    if (_disposed) return;
    _errorController.add(error);
  }

  /// Runs a media operation and translates whatever the platform throws
  /// into Raven's vocabulary.
  Future<void> _guardMedia(
    RavenPermission permission,
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } catch (error) {
      throw translateMediaError(permission, error);
    }
  }
}

/// Turns a platform media failure into a Raven error.
///
/// The native layer reports a denied permission as a `PlatformException`
/// whose message varies by OS and OS version, so this matches on the
/// substance instead of an exact code. Getting it wrong in the safe
/// direction, reporting a generic media error, is better than telling a
/// user to visit Settings when the real problem is a camera another app is
/// holding.
RavenException translateMediaError(RavenPermission permission, Object error) {
  if (error is RavenException) return error;

  final text = error.toString().toLowerCase();

  if (text.contains('permission') ||
      text.contains('denied') ||
      text.contains('notallowed')) {
    return RavenPermissionException(
      permission,
      // The platform doesn't tell us whether this was permanent, and
      // guessing "permanent" would send users to Settings unnecessarily.
      permanentlyDenied: false,
      cause: error,
    );
  }

  if (text.contains('notfound') || text.contains('no device')) {
    return RavenException(
      RavenErrorCode.deviceNotFound,
      'No ${permission.name} is available on this device.',
      error,
    );
  }

  return RavenException(
    RavenErrorCode.mediaError,
    'Could not change the ${permission.name}.',
    error,
  );
}
