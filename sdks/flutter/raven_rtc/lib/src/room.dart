import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart' as lk;

import 'errors.dart';
import 'types.dart';

/// A joined room.
///
/// Returned by `Raven.join()` — never constructed directly. Owns the
/// participant roster and every room-scoped action. No SDP, ICE
/// candidate, peer connection or LiveKit type reaches this API.
///
/// Extends [ChangeNotifier], which is the idiomatic Flutter way to expose
/// changing state: an `AnimatedBuilder`, `ListenableBuilder` or
/// `provider` can rebuild from it directly. This is where the Flutter SDK
/// deliberately diverges from the TypeScript one — the web SDK's
/// `room.on('event', handler)` would work in Dart but would feel foreign,
/// and the spec asks for idiomatic Dart rather than a transliteration
/// (§6). The *concepts* are identical; only the subscription mechanism
/// follows the platform.
///
/// Typed streams are available too, for logic that belongs outside the
/// widget tree.
class RavenRoom extends ChangeNotifier {
  RavenRoom._(this._room, this.roomId) {
    _listener = _room.createListener();
    _wireEvents();
  }

  /// @internal
  static RavenRoom attach(lk.Room room, String roomId) =>
      RavenRoom._(room, roomId);

  final lk.Room _room;
  late final lk.EventsListener<lk.RoomEvent> _listener;

  /// The room this connection was established for.
  final String roomId;

  final _connectionStateController =
      StreamController<RavenConnectionState>.broadcast();
  final _participantsController =
      StreamController<List<RavenParticipant>>.broadcast();
  final _errorController = StreamController<RavenException>.broadcast();

  bool _disposed = false;

  /// Connection state changes. Also reflected by [connectionState] and by
  /// [ChangeNotifier] notifications.
  Stream<RavenConnectionState> get connectionStateChanges =>
      _connectionStateController.stream;

  /// Fires whenever the roster or anyone's published tracks change.
  Stream<List<RavenParticipant>> get participantChanges =>
      _participantsController.stream;

  /// Errors that arrive asynchronously rather than from a call you made —
  /// a reconnect giving up, for instance.
  Stream<RavenException> get errors => _errorController.stream;

  RavenConnectionState get connectionState =>
      mapConnectionState(_room.connectionState);

  /// This device's participant.
  RavenParticipant get localParticipant =>
      RavenParticipant.wrap(_room.localParticipant!, isLocal: true);

  /// Everyone else currently in the room.
  List<RavenParticipant> get remoteParticipants => _room.remoteParticipants
      .values
      .map((p) => RavenParticipant.wrap(p, isLocal: false))
      .toList(growable: false);

  /// Local participant first, then remotes — the order a grid renders in.
  List<RavenParticipant> get participants =>
      [localParticipant, ...remoteParticipants];

  // ---------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------

  /// Captures and publishes the camera.
  ///
  /// Throws [RavenPermissionException] when the OS refuses access, rather
  /// than resolving to a silent black frame.
  Future<void> enableCamera() => _guardMedia(
        RavenPermission.camera,
        () => _room.localParticipant!.setCameraEnabled(true),
      );

  /// Stops publishing and releases the camera.
  Future<void> disableCamera() => _guardMedia(
        RavenPermission.camera,
        () => _room.localParticipant!.setCameraEnabled(false),
      );

  Future<void> enableMicrophone() => _guardMedia(
        RavenPermission.microphone,
        () => _room.localParticipant!.setMicrophoneEnabled(true),
      );

  Future<void> disableMicrophone() => _guardMedia(
        RavenPermission.microphone,
        () => _room.localParticipant!.setMicrophoneEnabled(false),
      );

  /// Starts screen sharing.
  ///
  /// Both platforms show a system consent dialog first, and both can have
  /// it dismissed — that surfaces as a [RavenException], not a silent
  /// no-op. On iOS this additionally requires a Broadcast Upload
  /// Extension in the host app; see docs/sdk/flutter.md#screen-sharing.
  Future<void> enableScreenShare() => _guardMedia(
        RavenPermission.camera,
        () => _room.localParticipant!.setScreenShareEnabled(true),
      );

  Future<void> disableScreenShare() => _guardMedia(
        RavenPermission.camera,
        () => _room.localParticipant!.setScreenShareEnabled(false),
      );

  /// Switches between the front and rear camera.
  ///
  /// A phone-only concern with no web equivalent, and common enough to
  /// deserve a first-class method rather than device enumeration.
  Future<void> switchCamera() async {
    final publication = _room.localParticipant?.trackPublications.values
        .cast<lk.TrackPublication?>()
        .firstWhere(
          (p) => p?.source == lk.TrackSource.camera,
          orElse: () => null,
        );

    final track = publication?.track;
    if (track is! lk.LocalVideoTrack) {
      throw const RavenException(
        RavenErrorCode.deviceNotFound,
        'No camera is currently publishing — call enableCamera() first.',
      );
    }

    try {
      final current = track.currentOptions as lk.CameraCaptureOptions;
      await track.setCameraPosition(
        current.cameraPosition == lk.CameraPosition.front
            ? lk.CameraPosition.back
            : lk.CameraPosition.front,
      );
    } catch (error) {
      throw RavenException(
        RavenErrorCode.mediaError,
        'Could not switch camera.',
        error,
      );
    }
  }

  /// Leaves the room and releases all local media.
  Future<void> leave() async {
    try {
      await _room.disconnect();
    } catch (_) {
      // Already gone. Leaving is the one operation that must never throw:
      // an app tearing a screen down has nothing useful to do with the
      // failure, and rethrowing here strands the UI.
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;

    // Order matters. Cancel the listener before closing the controllers,
    // or a late event tries to add to a closed stream and throws from a
    // zone the app can't catch.
    //
    // Both livekit disposals return Future<bool>. ChangeNotifier.dispose()
    // is synchronous, so they're explicitly unawaited rather than silently
    // dropped — the teardown is fire-and-forget by design, and saying so
    // keeps the unawaited_futures lint meaningful everywhere else.
    unawaited(_listener.dispose());
    _connectionStateController.close();
    _participantsController.close();
    _errorController.close();
    unawaited(_room.dispose());
    super.dispose();
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  void _wireEvents() {
    _listener
      ..on<lk.RoomDisconnectedEvent>((event) {
        _emitConnectionState();
        if (event.reason != null &&
            event.reason != lk.DisconnectReason.clientInitiated) {
          _emitError(
            const RavenException(
              RavenErrorCode.connectionFailed,
              'Disconnected from the room.',
            ),
          );
        }
      })
      ..on<lk.RoomReconnectingEvent>((_) => _emitConnectionState())
      ..on<lk.RoomReconnectedEvent>((_) => _emitConnectionState())
      ..on<lk.RoomConnectedEvent>((_) => _emitConnectionState())
      // Every event below changes what a grid should be showing. Missing
      // one leaves a stale or blank tile until an unrelated rebuild.
      ..on<lk.ParticipantConnectedEvent>((_) => _emitParticipants())
      ..on<lk.ParticipantDisconnectedEvent>((_) => _emitParticipants())
      ..on<lk.TrackSubscribedEvent>((_) => _emitParticipants())
      ..on<lk.TrackUnsubscribedEvent>((_) => _emitParticipants())
      ..on<lk.TrackPublishedEvent>((_) => _emitParticipants())
      ..on<lk.TrackUnpublishedEvent>((_) => _emitParticipants())
      ..on<lk.TrackMutedEvent>((_) => _emitParticipants())
      ..on<lk.TrackUnmutedEvent>((_) => _emitParticipants())
      ..on<lk.LocalTrackPublishedEvent>((_) => _emitParticipants())
      ..on<lk.LocalTrackUnpublishedEvent>((_) => _emitParticipants());
  }

  void _emitConnectionState() {
    if (_disposed) return;
    _connectionStateController.add(connectionState);
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
      throw _translateMediaError(permission, error);
    }
  }
}

/// Turns a platform media failure into a Raven error.
///
/// The native layer reports a denied permission as a
/// `PlatformException` whose message varies by OS and OS version, so this
/// matches on the substance rather than an exact code. Getting it wrong
/// in the safe direction — reporting a generic media error — is better
/// than telling a user to visit Settings when the real problem is a
/// camera another app is holding.
RavenException _translateMediaError(RavenPermission permission, Object error) {
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
