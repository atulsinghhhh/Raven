import 'package:raven_chat/raven_chat.dart'
    show RavenChat, RavenChatErrorCode, RavenChatException;
import 'package:raven_rtc/raven_rtc.dart' show Raven, RavenRoom;

import 'types.dart';

/// Raven Live Streaming on Flutter.
///
/// ```dart
/// final stream = await RavenLiveStream.join(credentials);
///
/// if (stream.isHost) {
///   await stream.room.enableCamera();
///   await stream.room.enableMicrophone();
/// }
///
/// await stream.react('❤️');
/// await stream.leave();
/// ```
///
/// A thin composition, not a parallel implementation: [room] *is* a
/// `raven_rtc` [RavenRoom] and [chat] *is* a `raven_chat` [RavenChat].
/// Every method and stream documented for those packages: participant
/// changes, camera/microphone, messages, reactions, typing, presence;
/// works unchanged on what this class hands back. Host vs. viewer publish
/// permission is enforced entirely server-side by the RTC token grant;
/// this class never sends a role, only reflects one it was given.
class RavenLiveStream {
  RavenLiveStream._(this.credentials, this._raven, this._chat, this._room);

  /// Joins a stream and connects its chat, if it has one.
  static Future<RavenLiveStream> join(
    RavenLiveStreamCredentials credentials,
  ) async {
    final raven = Raven(
      token: credentials.rtc.token,
      endpoint: credentials.rtc.endpoint,
      iceServers: credentials.rtc.iceServers,
    );

    RavenChat? chat;
    final chatCredentials = credentials.chat;
    if (chatCredentials != null) {
      chat = RavenChat(
        token: chatCredentials.token,
        apiUrl: chatCredentials.apiUrl,
        chatUrl: chatCredentials.chatUrl,
      );
    }

    final room = await raven.join(credentials.streamId);

    if (chat != null && chatCredentials != null) {
      final conversation = chatCredentials.conversations.isNotEmpty
          ? chatCredentials.conversations.first
          : credentials.streamId;
      try {
        await chat.connect(conversation);
      } catch (error) {
        // The room joined; don't strand it because chat failed. A caller
        // that genuinely needs chat will see `stream.chat` connect state
        // reflect the failure via its own connectionStateChanges stream.
        await room.leave();
        room.dispose();
        rethrow;
      }
    }

    return RavenLiveStream._(credentials, raven, chat, room);
  }

  final RavenLiveStreamCredentials credentials;
  final Raven _raven;
  final RavenChat? _chat;
  final RavenRoom _room;

  /// Which stream this is.
  String get streamId => credentials.streamId;

  /// This identity's role: never something inferred, only ever what the
  /// credentials said.
  RavenLiveStreamRole get role => credentials.role;

  /// `true` for [RavenLiveStreamRole.host] and [RavenLiveStreamRole.coHost].
  bool get isHost => role.isHost;

  /// The stream's room. Every `raven_rtc` API works on it unchanged.
  RavenRoom get room => _room;

  /// The stream's chat, if it has one attached. Every `raven_chat` API
  /// works on it unchanged.
  RavenChat? get chat => _chat;

  /// Reacts to the stream: the same reaction model web, CLI, and the
  /// server SDKs use, attached to the chat message every viewer's
  /// reaction lands on.
  ///
  /// Throws a [RavenChatException] with
  /// [RavenChatErrorCode.notInRoom] if this stream has no chat
  /// conversation attached.
  Future<void> react(String emoji) async {
    final chat = _chat;
    final rootMessageId = credentials.chatRootMessageId;
    if (chat == null || rootMessageId == null) {
      throw const RavenChatException(
        RavenChatErrorCode.notInRoom,
        'This stream has no chat conversation attached, so reactions are unavailable.',
      );
    }
    await chat.addReaction(rootMessageId, emoji);
  }

  /// Leaves the room and disposes the chat connection. Ending the stream
  /// itself (`LIVE` -> `ENDED`) is a separate, server-side call: see
  /// `@ravenkash/server`'s/`raven-sdk`'s `end_stream()`.
  Future<void> leave() async {
    await _raven.leave();
    _chat?.dispose();
  }
}
