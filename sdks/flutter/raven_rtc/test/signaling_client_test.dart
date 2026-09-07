import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:raven_rtc/raven_rtc.dart';
import 'package:raven_rtc/src/internal/protocol.dart';
import 'package:raven_rtc/src/internal/signaling_client.dart';
// trackKindFromSource is internal — imported directly rather than
// widening the public surface just to test it.
import 'package:raven_rtc/src/types.dart' show trackKindFromSource;

/// A socket a test drives directly.
///
/// This is why [RavenSocket] is an interface: the join handshake, the
/// error taxonomy and the reconnect decision are all worth testing, and
/// none of them needs a server or a WebRTC stack.
class FakeSocket implements RavenSocket {
  FakeSocket();

  final _incoming = StreamController<dynamic>.broadcast();
  final _closed = Completer<int?>();
  final sent = <Map<String, dynamic>>[];
  bool closeCalled = false;

  @override
  Stream<dynamic> get messages => _incoming.stream;

  @override
  Future<int?> get closed => _closed.future;

  @override
  void send(String data) =>
      sent.add(jsonDecode(data) as Map<String, dynamic>);

  @override
  Future<void> close([int? code, String? reason]) async {
    closeCalled = true;
    if (!_closed.isCompleted) _closed.complete(code);
  }

  /// Delivers a server message.
  void receive(Map<String, dynamic> message) =>
      _incoming.add(jsonEncode(message));

  /// Simulates the server or network closing the connection.
  void drop(int code) {
    if (!_closed.isCompleted) _closed.complete(code);
  }

  Map<String, dynamic>? lastSent(String type) {
    for (final message in sent.reversed) {
      if (message['type'] == type) return message;
    }
    return null;
  }
}

/// An unsigned Raven RTC token whose claims the client can read.
String fakeToken(Map<String, dynamic> claims) {
  String encode(Object value) =>
      base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
  return '${encode({'alg': 'HS256', 'typ': 'JWT'})}'
      '.${encode(claims)}'
      '.signature-not-checked-by-the-client';
}

void main() {
  group('decodeTokenClaims', () {
    test('reads the room and subject a token was minted for', () {
      final token = fakeToken({'rid': 'room-1', 'sub': 'alice'});
      final claims = decodeTokenClaims(token);

      expect(claims?['rid'], 'room-1');
      expect(claims?['sub'], 'alice');
    });

    test('returns null for anything that is not a three-part JWT', () {
      expect(decodeTokenClaims(''), isNull);
      expect(decodeTokenClaims('not-a-token'), isNull);
      expect(decodeTokenClaims('aa.bb'), isNull);
    });

    test('returns null rather than throwing on a corrupt payload', () {
      // A malformed token must not take down the join with a raw
      // FormatException from inside the SDK.
      expect(decodeTokenClaims('aaa.!!!not-base64!!!.ccc'), isNull);
    });
  });

  group('SignalingClient', () {
    late FakeSocket socket;

    SignalingClient clientFor({
      bool autoReconnect = false,
      Future<String> Function()? refreshToken,
    }) {
      socket = FakeSocket();
      return SignalingClient(
        endpoint: 'ws://localhost:4000/v1/rtc',
        token: fakeToken({'rid': 'room-1', 'sub': 'alice'}),
        roomId: 'room-1',
        autoReconnect: autoReconnect,
        refreshToken: refreshToken,
        socketFactory: (_) async => socket,
      );
    }

    test('sends room.join and completes on room.joined', () async {
      final client = clientFor();
      final joining = client.connect();

      // The join is sent as soon as the socket is handed over.
      await Future<void>.delayed(Duration.zero);
      expect(socket.lastSent(ClientMessageType.roomJoin), isNotNull);
      expect(socket.lastSent(ClientMessageType.roomJoin)!['roomId'], 'room-1');

      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [
          {'id': 'bob', 'tracks': []},
        ],
        'rtcServer': 'sfu-local-01',
        'region': 'local',
      });

      final joined = await joining;
      expect(joined.roomId, 'room-1');
      expect(joined.participants.single.id, 'bob');
      expect(joined.rtcServer, 'sfu-local-01');
      expect(client.isJoined, isTrue);

      await client.dispose();
    });

    test('puts the token in the URL, since a handshake carries no headers',
        () async {
      var requestedUrl = '';
      final token = fakeToken({'rid': 'room-1', 'sub': 'alice'});
      final probe = FakeSocket();
      final client = SignalingClient(
        endpoint: 'ws://localhost:4000/v1/rtc/',
        token: token,
        roomId: 'room-1',
        autoReconnect: false,
        socketFactory: (url) async {
          requestedUrl = url;
          return probe;
        },
      );

      final joining = client.connect();
      await Future<void>.delayed(Duration.zero);
      probe.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [],
      });
      await joining;

      // The trailing slash is normalised away rather than producing a
      // double slash before the query.
      expect(requestedUrl, startsWith('ws://localhost:4000/v1/rtc?token='));
      expect(requestedUrl, contains(Uri.encodeQueryComponent(token)));

      await client.dispose();
    });

    test('maps a rejected token onto a typed, actionable error', () async {
      final client = clientFor();
      final joining = client.connect();

      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.error,
        'code': SignalingErrorCode.tokenExpired,
        'message': 'RTC token has expired',
      });

      // TOKEN_EXPIRED rather than a generic auth failure: the caller
      // should refresh, not re-authenticate the user.
      await expectLater(
        joining,
        throwsA(isA<RavenException>()
            .having((e) => e.code, 'code', RavenErrorCode.tokenExpired)),
      );

      await client.dispose();
    });

    test('maps capacity and reachability failures onto connectionFailed',
        () async {
      for (final code in [
        SignalingErrorCode.roomFull,
        SignalingErrorCode.noRtcCapacity,
        SignalingErrorCode.rtcServerUnreachable,
      ]) {
        final client = clientFor();
        final joining = client.connect();
        await Future<void>.delayed(Duration.zero);
        socket.receive({
          'type': ServerMessageType.error,
          'code': code,
          'message': 'nope',
        });

        await expectLater(
          joining,
          throwsA(isA<RavenException>().having(
              (e) => e.code, 'code', RavenErrorCode.connectionFailed)),
        );
        await client.dispose();
      }
    });

    test('forwards ordinary server messages to listeners', () async {
      final client = clientFor();
      final joining = client.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [],
      });
      await joining;

      final received = <Map<String, dynamic>>[];
      final subscription = client.messages.listen(received.add);

      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);

      expect(received.single['type'], ServerMessageType.sdpOffer);
      expect(received.single['sdp'], 'v=0 offer');

      await subscription.cancel();
      await client.dispose();
    });

    test('ignores a non-text frame instead of guessing at it', () async {
      final client = clientFor();
      final joining = client.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [],
      });
      await joining;

      final received = <Map<String, dynamic>>[];
      final subscription = client.messages.listen(received.add);

      // Raven's signaling is text-only. A binary frame means something
      // else is on this socket.
      socket._incoming.add([1, 2, 3]);
      socket._incoming.add('{not json');
      await Future<void>.delayed(Duration.zero);

      expect(received, isEmpty);

      await subscription.cancel();
      await client.dispose();
    });

    test('reports a fatal error and does not reconnect', () async {
      final client = clientFor(autoReconnect: true);
      final joining = client.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [],
      });
      await joining;

      final lifecycle = <SignalingLifecycle>[];
      final subscription = client.lifecycle.listen(lifecycle.add);

      // A rejected credential is not something a reconnect can fix.
      socket.receive({
        'type': ServerMessageType.error,
        'code': SignalingErrorCode.unauthorized,
        'message': 'not allowed in this room',
      });
      await Future<void>.delayed(Duration.zero);

      expect(lifecycle.whereType<SignalingFailed>(), hasLength(1));
      expect(lifecycle.whereType<SignalingReconnecting>(), isEmpty);
      expect(socket.closeCalled, isTrue);

      await subscription.cancel();
      await client.dispose();
    });

    test('fails immediately when autoReconnect is off', () async {
      final client = clientFor(autoReconnect: false);
      final joining = client.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [],
      });
      await joining;

      final lifecycle = <SignalingLifecycle>[];
      final subscription = client.lifecycle.listen(lifecycle.add);

      socket.drop(1006);
      await Future<void>.delayed(Duration.zero);

      expect(lifecycle.single, isA<SignalingFailed>());

      await subscription.cancel();
      await client.dispose();
    });

    test('refreshes the token before reconnecting', () async {
      // A reconnect after a long outage very often has an expired token,
      // and discovering that by being rejected costs an extra round trip
      // (spec §21).
      var refreshes = 0;
      final client = clientFor(
        autoReconnect: true,
        refreshToken: () async {
          refreshes++;
          return fakeToken({'rid': 'room-1', 'sub': 'alice'});
        },
      );

      final joining = client.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [],
      });
      await joining;

      final lifecycle = <SignalingLifecycle>[];
      final subscription = client.lifecycle.listen(lifecycle.add);

      socket.drop(4001); // the server's credential-rejected close code
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(lifecycle.whereType<SignalingReconnecting>(), isNotEmpty);
      expect(refreshes, greaterThanOrEqualTo(1));

      await subscription.cancel();
      await client.dispose();
    });

    test('close() leaves the room and suppresses reconnection', () async {
      final client = clientFor(autoReconnect: true);
      final joining = client.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [],
      });
      await joining;

      final lifecycle = <SignalingLifecycle>[];
      final subscription = client.lifecycle.listen(lifecycle.add);

      await client.close();
      await Future<void>.delayed(Duration.zero);

      expect(socket.lastSent(ClientMessageType.roomLeave), isNotNull);
      expect(lifecycle.whereType<SignalingReconnecting>(), isEmpty);
      expect(client.isJoined, isFalse);

      await subscription.cancel();
      await client.dispose();
    });
  });

  group('protocol parsing', () {
    test('a joined payload tolerates missing optional fields', () {
      // A newer or older server must not crash the client over a field it
      // did not send.
      final payload = JoinedPayload.fromJson({'roomId': 'room-1'});
      expect(payload.participants, isEmpty);
      expect(payload.rtcServer, isNull);
    });

    test('a track defaults to not-muted, not-simulcast', () {
      final track = ServerTrack.fromJson({'trackId': 't1', 'kind': 'video'});
      expect(track.muted, isFalse);
      expect(track.simulcast, isFalse);
      expect(track.layers, isEmpty);
      expect(track.source, 'unknown');
    });

    test('an unrecognised source maps to unknown rather than throwing', () {
      // Treating a source this version does not know as an error would
      // break an app on a server upgrade it did not ask for.
      expect(trackKindFromSource('hologram'), RavenTrackKind.unknown);
      expect(trackKindFromSource('screenShare'), RavenTrackKind.screenShare);
    });
  });
}
