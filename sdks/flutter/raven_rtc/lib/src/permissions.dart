import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart' as lk;

import 'errors.dart';

/// Camera and microphone permissions.
///
/// Flutter has no permissions API in the framework itself, and the usual
/// answer — `permission_handler` — is one more plugin for every app to
/// add and configure. Raven doesn't require it: on both iOS and Android,
/// asking for the device is what raises the OS prompt, so this asks for
/// the device and reads the outcome.
///
/// The consequence is worth stating plainly: [request] genuinely prompts,
/// but a pure "what is the status right now" check isn't possible without
/// a native module, so this class doesn't pretend to offer one. See
/// docs/sdk/flutter.md#permissions for how to combine it with
/// `permission_handler` when an app needs pre-flight status.
///
/// **Manifest entries the SDK cannot add for you:**
///
/// * iOS `Info.plist` — `NSCameraUsageDescription` and
///   `NSMicrophoneUsageDescription`. Missing either one crashes the app
///   the instant it asks, which surfaces as an App Store review failure
///   rather than a bug report.
/// * Android `AndroidManifest.xml` — `android.permission.CAMERA`,
///   `android.permission.RECORD_AUDIO`, `android.permission.INTERNET`.
class RavenPermissions {
  const RavenPermissions._();

  /// Prompts for the given permissions and reports what the user chose.
  ///
  /// Never throws — inspect the map, or use [require] if you'd rather
  /// have an exception.
  static Future<Map<RavenPermission, bool>> request([
    List<RavenPermission> permissions = const [
      RavenPermission.camera,
      RavenPermission.microphone,
    ],
  ]) async {
    final result = <RavenPermission, bool>{};
    for (final permission in permissions) {
      result[permission] = await _probe(permission);
    }
    return result;
  }

  /// Prompts, and throws [RavenPermissionException] for anything refused.
  ///
  /// Worth calling before joining when your app needs both devices:
  /// surfacing a refusal up front beats discovering it when the user taps
  /// the camera button mid-call.
  static Future<void> require([
    List<RavenPermission> permissions = const [
      RavenPermission.camera,
      RavenPermission.microphone,
    ],
  ]) async {
    final granted = await request(permissions);

    for (final entry in granted.entries) {
      if (!entry.value) {
        throw RavenPermissionException(
          entry.key,
          // Neither platform tells us from here whether the refusal was
          // permanent. Claiming it was would send users to Settings for a
          // dialog they could simply have been shown again.
          permanentlyDenied: false,
        );
      }
    }
  }

  /// Opens the device, then immediately closes it again.
  ///
  /// Acquiring the track is the only way to raise the permission dialog
  /// from Dart. It's released straight away — this is a probe, not a
  /// capture session, and holding it would leave the camera indicator lit
  /// on a screen that isn't showing video.
  static Future<bool> _probe(RavenPermission permission) async {
    lk.LocalTrack? track;
    try {
      track = permission == RavenPermission.camera
          ? await lk.LocalVideoTrack.createCameraTrack()
          : await lk.LocalAudioTrack.create();
      return true;
    } catch (error) {
      // Logged rather than swallowed: a developer debugging a refused
      // camera needs to see the platform's own message, which is more
      // specific than anything this layer could reconstruct.
      debugPrint('[raven] ${permission.name} permission probe failed: $error');
      return false;
    } finally {
      await track?.stop();
      await track?.dispose();
    }
  }
}
