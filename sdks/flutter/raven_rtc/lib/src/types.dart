import 'package:flutter_webrtc/flutter_webrtc.dart' as rtc;
import 'package:meta/meta.dart';

/// Signaling lifecycle, mirroring the web SDK's `ConnectionState`.
///
/// **This is the control plane, and only the control plane.** It is set
/// from the signaling socket alone — `room.joined`, `reconnecting`,
/// `disconnected`, `failed` — so a room reads [connected] as soon as the
/// server has accepted the join, whatever the media transport is doing.
/// A room whose ICE transport has failed outright still reads [connected]
/// here, because the socket carrying that news is itself perfectly
/// healthy.
///
/// That is the right answer to "am I in the room", and the wrong one to
/// "is video flowing". For the second question use
/// [RavenRoom.mediaState], which reports the peer connection itself.
/// A UI that labels this one "connected" with no qualifier is the reason
/// [RavenMediaState] exists.
enum RavenConnectionState {
  disconnected,
  connecting,
  connected,
  reconnecting,
  failed,
}

/// Health of the media transport: whether packets can actually flow.
///
/// The counterpart to [RavenConnectionState], and the one to believe when
/// the question is "why is there no video". Signaling and media are
/// separate connections over separate paths — a WebSocket to the control
/// plane, and an ICE/DTLS transport to the SFU — and they fail
/// independently. A corporate network that permits outbound TLS but drops
/// UDP produces a room that joins cleanly, lists its participants, relays
/// chat, and never carries a single frame.
///
/// Read from the peer connection's own state, not inferred from anything
/// the SDK did.
enum RavenMediaState {
  /// No peer connection yet: nobody has published or subscribed.
  idle,

  /// Gathering candidates and trying to establish a transport.
  connecting,

  /// A transport is up. Media can flow.
  connected,

  /// The transport dropped. ICE is still trying, and this often recovers
  /// on its own within a few seconds — a phone changing network usually
  /// passes through here. Worth showing as a warning, not an error.
  interrupted,

  /// ICE gave up. Nothing will flow on this connection again; recovery
  /// means a new one, which a signaling reconnect brings about.
  failed,

  /// The connection was closed, by [RavenRoom.leave] or a reconnect
  /// tearing the old session down.
  closed,
}

/// What a track carries.
///
/// `unknown` exists because the SFU can in principle report a source this
/// version doesn't know: treating that as an error would break an app on
/// a server upgrade it didn't ask for.
enum RavenTrackKind { camera, microphone, screenShare, unknown }

/// @internal The simulcast layer a subscriber is asking the SFU for.
///
/// Internal on purpose: `RavenRoom.requestLayer` takes the wire string, and
/// has since before this existed. Adding an enum to the public signature
/// would break every existing caller to buy type safety on four values that
/// are already documented.
///
/// `auto` is not a fourth layer. It hands the choice back to the SFU
/// (highest available) and releases any pin an application had set.
enum RavenVideoLayer { low, medium, high, auto }

/// @internal The wire name for a layer. The protocol carries these
/// strings, and they are the same three RIDs the publisher sends.
extension RavenVideoLayerWire on RavenVideoLayer {
  String get wireName => switch (this) {
        RavenVideoLayer.low => 'low',
        RavenVideoLayer.medium => 'medium',
        RavenVideoLayer.high => 'high',
        RavenVideoLayer.auto => 'auto',
      };
}

/// Whether a published camera is genuinely sending a simulcast ladder.
///
/// Worth reporting rather than assuming, because for a long time this SDK
/// assumed. Simulcast was configured with `setParameters()` after
/// `addTrack()`, which the WebRTC specification requires implementations to
/// reject — the number of encodings is fixed once a sender exists — and the
/// rejection was swallowed. Every publisher sent one full-resolution layer
/// while the code believed it was sending three, and there was no way to
/// tell from the outside.
///
/// So this is deliberately observable: [RavenRoom.simulcastStatusFor] reads
/// it back from the negotiated sender parameters after publishing, not from
/// what was requested.
enum RavenSimulcastStatus {
  /// Three layers negotiated and confirmed present on the sender.
  enabled,

  /// The platform refused the ladder. One full-quality layer is being
  /// sent; subscribers cannot drop to a cheaper one. A warning was logged.
  unsupported,

  /// Not a simulcast track: microphones have no spatial layers, and screen
  /// shares deliberately send one high-quality layer because dropping
  /// resolution wrecks text legibility.
  notApplicable,

  /// Published, but the negotiation that would confirm the ladder has not
  /// finished yet.
  pending,
}

/// @internal Maps the wire protocol's source string onto Livqeno's enum.
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

  /// Identity, and only identity: two snapshots of the same person are
  /// equal however different what they are publishing is. That is what
  /// makes a roster diff stable across a publish — the same person is the
  /// same tile — but it also means `oldParticipant != newParticipant` is
  /// never the test for "have they started a camera". Ask
  /// [isCameraEnabled] or [videoTrackFor] instead; `didUpdateWidget`
  /// guarded on `!=` silently skips exactly the update that matters.
  @override
  bool operator ==(Object other) =>
      other is RavenParticipant && other.identity == identity;

  @override
  int get hashCode => identity.hashCode;

  @override
  String toString() => 'RavenParticipant($identity${isLocal ? ', local' : ''})';
}
