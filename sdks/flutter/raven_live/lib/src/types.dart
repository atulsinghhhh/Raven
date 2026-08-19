import 'package:raven_rtc/raven_rtc.dart' show RavenIceServer;

/// A stream identity's role — the same three values the backend, the
/// server SDKs, and the web/React/React Native SDKs all use. HOST and
/// CO_HOST carry identical RTC/chat grants; the difference is bookkeeping,
/// never something this SDK infers on its own.
enum RavenLiveStreamRole { host, coHost, viewer }

/// `true` for [RavenLiveStreamRole.host] and [RavenLiveStreamRole.coHost].
extension RavenLiveStreamRoleX on RavenLiveStreamRole {
  bool get isHost =>
      this == RavenLiveStreamRole.host || this == RavenLiveStreamRole.coHost;
}

/// Parses the wire value (`"HOST"`, `"CO_HOST"`, `"VIEWER"`) your backend
/// sends. Throws on anything else — silently defaulting an unrecognised
/// role would be the one place getting this wrong actually matters.
RavenLiveStreamRole ravenLiveStreamRoleFromJson(String value) {
  switch (value) {
    case 'HOST':
      return RavenLiveStreamRole.host;
    case 'CO_HOST':
      return RavenLiveStreamRole.coHost;
    case 'VIEWER':
      return RavenLiveStreamRole.viewer;
    default:
      throw ArgumentError.value(value, 'value', 'Unknown live stream role.');
  }
}

/// The RTC half of a stream credential — identical fields to what
/// `Raven(token:, endpoint:)` already takes.
class RavenLiveStreamRtcCredentials {
  const RavenLiveStreamRtcCredentials({
    required this.token,
    required this.endpoint,
    this.iceServers,
  });

  factory RavenLiveStreamRtcCredentials.fromJson(Map<String, dynamic> json) =>
      RavenLiveStreamRtcCredentials(
        token: json['token'] as String,
        endpoint: json['endpoint'] as String,
        iceServers: (json['iceServers'] as List<dynamic>?)
            ?.map((server) =>
                RavenIceServer.fromJson(server as Map<String, dynamic>))
            .toList(growable: false),
      );

  final String token;
  final String endpoint;
  final List<RavenIceServer>? iceServers;
}

/// The chat half of a stream credential. Absent entirely when the stream
/// has no chat conversation attached.
class RavenLiveStreamChatCredentials {
  const RavenLiveStreamChatCredentials({
    required this.token,
    required this.conversations,
    this.apiUrl,
    this.chatUrl,
  });

  factory RavenLiveStreamChatCredentials.fromJson(Map<String, dynamic> json) =>
      RavenLiveStreamChatCredentials(
        token: json['token'] as String,
        apiUrl: json['apiUrl'] as String?,
        chatUrl: json['chatUrl'] as String?,
        conversations: (json['conversations'] as List<dynamic>? ?? const [])
            .map((value) => value as String)
            .toList(growable: false),
      );

  final String token;
  final String? apiUrl;
  final String? chatUrl;

  /// The conversation(s) this token may touch. [RavenLiveStream] connects
  /// to the first one — a stream has exactly one chat conversation today.
  final List<String> conversations;
}

/// Everything [RavenLiveStream.join] needs, minted server-side by
/// `@corvidhq/server`'s `addHost()`/`createViewerToken()` (or the
/// equivalent `raven-sdk` call) — never construct one of these by hand.
///
/// Mirrors `@corvidhq/client`'s `LiveStreamCredentials` field-for-field,
/// which is the reason [RavenLiveStreamCredentials.fromJson] accepts
/// exactly the JSON your backend forwards without any translation.
class RavenLiveStreamCredentials {
  const RavenLiveStreamCredentials({
    required this.streamId,
    required this.role,
    required this.rtc,
    this.chat,
    this.chatRootMessageId,
  });

  factory RavenLiveStreamCredentials.fromJson(Map<String, dynamic> json) =>
      RavenLiveStreamCredentials(
        streamId: json['streamId'] as String,
        role: ravenLiveStreamRoleFromJson(json['role'] as String),
        rtc: RavenLiveStreamRtcCredentials.fromJson(
            json['rtc'] as Map<String, dynamic>),
        chat: json['chat'] == null
            ? null
            : RavenLiveStreamChatCredentials.fromJson(
                json['chat'] as Map<String, dynamic>),
        chatRootMessageId: json['chatRootMessageId'] as String?,
      );

  final String streamId;
  final RavenLiveStreamRole role;
  final RavenLiveStreamRtcCredentials rtc;
  final RavenLiveStreamChatCredentials? chat;

  /// The chat message every viewer's reaction attaches to. `null` for a
  /// stream with no chat conversation attached.
  final String? chatRootMessageId;
}
