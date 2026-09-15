import 'package:flutter_test/flutter_test.dart';
import 'package:raven_rtc/src/internal/engine.dart';
import 'package:raven_rtc/src/internal/protocol.dart';
import 'package:raven_rtc/src/internal/signaling_client.dart';
import 'package:raven_rtc/src/room.dart';
import 'package:raven_rtc/src/types.dart';

import 'helpers/fake_socket.dart';
import 'helpers/fake_webrtc_platform.dart';

void main() {
  late FakeSocket socket;
  late FakeWebRtcPlatform platform;

  setUp(() => platform = FakeWebRtcPlatform());
  tearDown(() => platform.dispose());

  SignalingClient clientFor({bool autoReconnect = true}) {
    socket = FakeSocket();
    return SignalingClient(
      endpoint: 'ws://localhost:4000/v1/rtc',
      token: fakeToken({'rid': 'room-1', 'sub': 'alice'}),
      roomId: 'room-1',
      autoReconnect: autoReconnect,
      // A fresh socket per attempt: a reconnect opens a brand new
      // connection, and reusing the dropped one would carry over its
      // already-completed `closed` future, making the reconnect look
      // instantly dead before it ever gets to join.
      socketFactory: (_) async => socket = FakeSocket(),
    );
  }

  group('RavenRoom.attach wiring order (spec §3-4)', () {
    test('REGRESSION: a joins listener attached only after connect() resolves misses the first join', () async {
      // Direct proof of the mechanism the fix closes: SignalingClient
      // fires `_joins.add()` synchronously inside the very callback that
      // resolves `connect()` -- before that callback even returns, let
      // alone before anything awaiting connect() runs. The pre-fix
      // RavenRoom.attach() built the room (and so subscribed to
      // signaling.joins) only *after* awaiting connect(), which — as this
      // proves — is provably too late for the first join, every time,
      // not just under adverse timing.
      final signaling = clientFor();
      final joining = signaling.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({'type': ServerMessageType.roomJoined, 'roomId': 'room-1', 'participants': []});
      await joining;

      var receivedAfter = false;
      signaling.joins.listen((_) => receivedAfter = true);
      await Future<void>.delayed(Duration.zero);

      expect(receivedAfter, isFalse);
      await signaling.dispose();
    });

    test('the fix: RavenRoom.attach() wires the room before connect() is called, so the first join is never missed', () async {
      final signaling = clientFor();
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);

      // Matches Raven.join(): attach() runs, *then* connect() is called.
      final room = RavenRoom.attach(
        signaling: signaling,
        engine: engine,
        roomId: 'room-1',
        localIdentity: 'alice',
      );
      expect(room.connectionState, RavenConnectionState.connecting,
          reason: 'not "connected" yet -- the join has not resolved');

      final joining = signaling.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [
          {
            'id': 'bob',
            'tracks': [
              {'trackId': 't1', 'kind': 'video', 'source': 'camera'}
            ],
          }
        ],
        'rtcServer': 'sfu-local-01',
        'region': 'local',
      });
      final joined = await joining;
      room.applyInitialJoin(joined);
      await Future<void>.delayed(Duration.zero);

      // All of this depends on RavenRoom._handleJoined having actually
      // run for the *first* join -- which is exactly what used to be
      // skipped (spec §6): _applyJoined() ran (old code called it
      // directly), but engine.applyJoinedState() never did.
      expect(room.rtcServer, 'sfu-local-01');
      expect(room.region, 'local');
      expect(room.remoteParticipants.map((p) => p.identity), ['bob']);
      expect(room.connectionState, RavenConnectionState.connected);

      room.dispose();
      // Let the fire-and-forget engine/signaling teardown finish
      // inside this test, not bleed into the next one's platform mock.
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    });

    test('an sdp.offer immediately after room.joined is answered end to end through Raven.join()\'s real wiring', () async {
      final signaling = clientFor();
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);
      final room = RavenRoom.attach(
        signaling: signaling,
        engine: engine,
        roomId: 'room-1',
        localIdentity: 'alice',
      );

      final joining = signaling.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({'type': ServerMessageType.roomJoined, 'roomId': 'room-1', 'participants': []});
      final joined = await joining;
      room.applyInitialJoin(joined);

      // The SFU's very next message.
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(socket.lastSent(ClientMessageType.sdpAnswer), isNotNull,
          reason: 'the subscriber transport must actually come up -- see spec §3');

      room.dispose();
      // Let the fire-and-forget engine/signaling teardown finish
      // inside this test, not bleed into the next one's platform mock.
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    });
  });

  group('applyJoinedState on reconnect', () {
    test('a reconnect reconciles the roster: departed participants are dropped, new ones appear', () async {
      final signaling = clientFor(autoReconnect: true);
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);
      final room = RavenRoom.attach(
        signaling: signaling,
        engine: engine,
        roomId: 'room-1',
        localIdentity: 'alice',
      );

      final joining = signaling.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [
          {'id': 'bob', 'tracks': []},
        ],
      });
      final joined = await joining;
      room.applyInitialJoin(joined);
      await Future<void>.delayed(Duration.zero);
      expect(room.remoteParticipants.map((p) => p.identity), ['bob']);

      // Reconnect: bob left during the outage, carol joined.
      socket.drop(1006);
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(room.connectionState, RavenConnectionState.reconnecting);

      socket.receive({
        'type': ServerMessageType.roomJoined,
        'roomId': 'room-1',
        'participants': [
          {'id': 'carol', 'tracks': []},
        ],
        'rtcServer': 'sfu-local-02',
      });
      await Future<void>.delayed(Duration.zero);

      expect(room.remoteParticipants.map((p) => p.identity), ['carol']);
      expect(room.rtcServer, 'sfu-local-02');
      expect(room.connectionState, RavenConnectionState.connected);

      room.dispose();
      // Let the fire-and-forget engine/signaling teardown finish
      // inside this test, not bleed into the next one's platform mock.
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    });
  });

  group('receive-only participants and the data channel (spec §8)', () {
    test('listening to room.data opens a local data channel even though nothing is published or sent', () async {
      final signaling = clientFor();
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);
      final room = RavenRoom.attach(
        signaling: signaling,
        engine: engine,
        roomId: 'room-1',
        localIdentity: 'alice',
      );

      final joining = signaling.connect();
      await Future<void>.delayed(Duration.zero);
      socket.receive({'type': ServerMessageType.roomJoined, 'roomId': 'room-1', 'participants': []});
      final joined = await joining;
      room.applyInitialJoin(joined);

      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(platform.calls, isNot(contains('createDataChannel')));

      final subscription = room.data.listen((_) {});
      await Future<void>.delayed(Duration.zero);

      expect(platform.calls, contains('createDataChannel'),
          reason: 'a receive-only participant still needs a channel for the SFU to relay onto');

      await subscription.cancel();
      room.dispose();
      // Let the fire-and-forget engine/signaling teardown finish
      // inside this test, not bleed into the next one's platform mock.
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    });
  });
}
