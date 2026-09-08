/// Stable, typed error codes this SDK can raise.
///
/// These are the same codes `@raven/rtc` uses on the web, by design: a
/// team shipping both a web app and a Flutter app should be reading the
/// same vocabulary in both places, and a support conversation shouldn't
/// depend on which platform the user was on.
enum RavenErrorCode {
  invalidToken,
  tokenExpired,
  roomNotFound,
  connectionFailed,
  permissionDenied,
  cameraPermissionDenied,
  microphonePermissionDenied,
  deviceNotFound,
  networkError,
  signalingError,
  mediaError,
  timeout,
}

/// The one error type this SDK throws.
///
/// Never a raw `flutter_webrtc` error, never a `PlatformException` from
/// the native layer. Those leak implementation details a developer using
/// Raven has no way to act on, and would tie application error handling
/// to whichever WebRTC implementation Raven happens to use.
class RavenException implements Exception {
  const RavenException(this.code, this.message, [this.cause]);

  final RavenErrorCode code;
  final String message;

  /// The underlying failure, kept for logging. Never surfaced in
  /// [message], which is written for a developer rather than assembled
  /// from a native stack trace.
  final Object? cause;

  @override
  String toString() => 'RavenException(${code.name}): $message';
}

/// Thrown when the operating system refuses camera or microphone access.
///
/// Mobile's one genuinely new failure mode compared to the web. It's a
/// subclass instead of a separate type so `on RavenException` still
/// catches it, while `on RavenPermissionException` can offer the "open
/// Settings" path that a plain denial doesn't need.
class RavenPermissionException extends RavenException {
  const RavenPermissionException(
    this.permission, {
    required this.permanentlyDenied,
    Object? cause,
  }) : super(
          permission == RavenPermission.camera
              ? RavenErrorCode.cameraPermissionDenied
              : RavenErrorCode.microphonePermissionDenied,
          permanentlyDenied
              ? 'Access was permanently denied. The user must enable it in system settings — prompting again will not show a dialog.'
              : 'Access was denied.',
          cause,
        );

  final RavenPermission permission;

  /// True when re-prompting does nothing and only the system settings
  /// screen will help. The two cases need different UI, so the SDK
  /// reports which one happened, not making the app guess.
  final bool permanentlyDenied;
}

enum RavenPermission { camera, microphone }
