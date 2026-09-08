/// Raven for Flutter: real-time audio and video.
///
/// ```dart
/// final raven = Raven(token: token, endpoint: endpoint);
/// final room = await raven.join('room_123');
///
/// await room.enableCamera();
/// await room.enableMicrophone();
/// ```
///
/// The same concepts as Raven Web and Raven React Native: a room, a
/// participant, a camera, a microphone. Only the syntax follows Dart.
///
/// For messaging, add `raven_chat`: the two are independent packages, so
/// a video app never carries a message store and a chat app never carries
/// WebRTC.
library;

export 'src/effects.dart'
    show
        RavenEffectBeauty,
        RavenEffectFilters,
        RavenEffectInstance,
        RavenEffectParamSpec,
        RavenEffectPresets,
        RavenEffectsEngineStatus,
        RavenEffectsErrorCode,
        RavenEffectsException,
        RavenEffectsPipeline,
        RavenFilterConfig,
        RavenPreset,
        ravenEffectsNativeEngineStatus;
export 'src/errors.dart'
    show
        RavenErrorCode,
        RavenException,
        RavenPermission,
        RavenPermissionException;
export 'src/permissions.dart' show RavenPermissions;
export 'src/raven.dart' show Raven, RavenIceServer;
export 'src/room.dart' show RavenRoom;
export 'src/types.dart'
    show
        RavenConnectionState,
        RavenParticipant,
        RavenRenderableTrack,
        RavenTrackKind;
export 'src/video_view.dart' show RavenVideoFit, RavenVideoView;

// Deliberately not exported: flutter_webrtc, the signaling client, the
// peer-connection engine, and every other implementation detail. A
// developer using Raven should never need to name a WebRTC type (spec §2).
//
// `RavenRenderableTrack` is the one borderline case: it carries a
// flutter_webrtc MediaStream, and it is exported only so the type
// `RavenParticipant.videoTrackFor` returns is nameable instead of leaked
// and unmentionable. It exists for RavenVideoView; an application should
// not need it.
