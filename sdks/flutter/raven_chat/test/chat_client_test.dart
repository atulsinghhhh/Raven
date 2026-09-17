import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:raven_chat/raven_chat.dart';

import 'helpers/fake_chat_socket.dart';

/// Protocol-level tests for the two things a real integration gets wrong
/// first: typing signals refused by the server's rate limit, and presence
/// quietly lost the moment the socket blinks.
void main() {
  late List<FakeChatSocket> sockets;

  /// A connected client, plus the socket it is holding.
  Future<({RavenChat chat, FakeChatSocket socket})> connected({
    String room = 'conv_1',
  }) async {
    sockets = [];
    final chat = RavenChat(
      token: 'test-token',
      apiUrl: 'https://api.example.test',
      connectChannel: (uri) {
        final socket = FakeChatSocket();
        sockets.add(socket);
        // The server's hello has to land after the client has subscribed,
        // which happens synchronously just after this factory returns.
        scheduleMicrotask(socket.acceptConnection);
        return socket;
      },
    );

    final connecting = chat.connect(room);
    // `connect()` awaits the hello, then the room join's ack.
    await Future<void>.delayed(Duration.zero);
    sockets.last.ackPending();
    await connecting;

    return (chat: chat, socket: sockets.last);
  }

  group('startTyping is throttled to what the server will accept', () {
    test(
        'REGRESSION: a burst of keystrokes sends one frame, not one per keystroke',
        () async {
      final context = await connected();

      // What "safe to call on every keystroke" actually looks like. Sent
      // unthrottled, this is 10 of the 20 frames per 10s the server
      // allows, and a real sentence blows straight through it.
      for (var i = 0; i < 10; i++) {
        await context.chat.startTyping();
      }

      expect(context.socket.ofType('typing.start'), hasLength(1));

      context.chat.dispose();
    });

    test('stopping and starting again signals immediately', () async {
      final context = await connected();

      await context.chat.startTyping();
      await context.chat.stopTyping();
      await context.chat.startTyping();

      // The throttle must not swallow a genuine new transition: the
      // indicator has already been cleared, so this one carries
      // information the previous window's frames did not.
      expect(context.socket.ofType('typing.start'), hasLength(2));
      expect(context.socket.ofType('typing.stop'), hasLength(1));

      context.chat.dispose();
    });

    test('each room is throttled on its own', () async {
      final context = await connected();

      await context.chat.startTyping(room: 'conv_1');
      await context.chat.startTyping(room: 'conv_2');

      // Two different conversations, two different indicators. Sharing
      // one window between them would hide the second entirely.
      expect(context.socket.ofType('typing.start'), hasLength(2));

      context.chat.dispose();
    });
  });

  group('presence survives a reconnect', () {
    test(
        'REGRESSION: presence set before a drop is re-asserted on the new socket',
        () async {
      final context = await connected();
      await context.chat.setPresence(RavenPresenceStatus.online);
      expect(context.socket.ofType('presence.set'), hasLength(1));

      // The network drops. The client reconnects onto a brand new socket,
      // which knows nothing about what was set on the old one — so
      // without re-asserting, this user is invisible to everybody else
      // for the rest of the session while still reading `connected`.
      context.socket.drop(1006);
      await Future<void>.delayed(const Duration(milliseconds: 700));
      expect(sockets, hasLength(2),
          reason: 'the client should have reconnected by now');

      final reconnected = sockets.last;
      reconnected.ackPending();
      await Future<void>.delayed(Duration.zero);

      expect(reconnected.ofType('presence.set'), hasLength(1));
      expect(
        reconnected.ofType('presence.set').single['status'],
        RavenPresenceStatus.online.name,
      );

      // Ahead of the rejoin, so the server never processes a join for
      // somebody it currently believes is absent.
      final types = reconnected.sent.map((frame) => frame['type']).toList();
      expect(
          types.indexOf('presence.set'), lessThan(types.indexOf('room.join')));

      context.chat.dispose();
    });

    test('a client that never set presence stays silent about it', () async {
      final context = await connected();

      context.socket.drop(1006);
      await Future<void>.delayed(const Duration(milliseconds: 700));
      expect(sockets, hasLength(2));

      // Announcing a status nobody chose would invent one — and would
      // make a deliberately invisible client (a moderation view, a bot)
      // impossible to build.
      expect(sockets.last.ofType('presence.set'), isEmpty);

      context.chat.dispose();
    });
  });
}
