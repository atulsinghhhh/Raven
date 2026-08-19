/// Raven Live Streaming for Flutter.
///
/// ```dart
/// final stream = await RavenLiveStream.join(credentials);
///
/// if (stream.isHost) {
///   await stream.room.enableCamera();
///   await stream.room.enableMicrophone();
/// }
///
/// stream.room.participantChanges.listen((participants) { ... });
/// stream.chat?.messages.listen((message) { ... });
///
/// await stream.react('❤️');
/// await stream.leave();
/// ```
///
/// The same concepts as Raven Web, React, and React Native: a stream, a
/// host, co-hosts, viewers, live chat, reactions. Only the syntax follows
/// Dart.
///
/// Composes `raven_rtc` and `raven_chat` rather than reimplementing
/// either — `RavenLiveStream.room` is an ordinary [RavenRoom] and
/// `RavenLiveStream.chat` is an ordinary [RavenChat], so every existing
/// API on both packages already works on a stream.
library raven_live;

export 'package:raven_chat/raven_chat.dart' show RavenChat;
export 'package:raven_rtc/raven_rtc.dart' show RavenRoom;

export 'src/live_stream.dart' show RavenLiveStream;
export 'src/types.dart'
    show
        RavenLiveStreamChatCredentials,
        RavenLiveStreamCredentials,
        RavenLiveStreamRole,
        RavenLiveStreamRoleX,
        RavenLiveStreamRtcCredentials;

// Deliberately not re-exported here: everything raven_rtc/raven_chat
// themselves keep private (livekit_client, flutter_webrtc, the WebSocket
// channel, the frame vocabulary). Import raven_rtc/raven_chat directly
// for anything beyond RavenRoom/RavenChat — this package only adds the
// stream-level composition on top.
