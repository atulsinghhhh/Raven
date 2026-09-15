import 'package:flutter_test/flutter_test.dart';
import 'package:raven_rtc/src/internal/engine.dart';
import 'package:raven_rtc/src/internal/protocol.dart';
import 'package:raven_rtc/src/internal/signaling_client.dart';

import 'helpers/fake_socket.dart';
import 'helpers/fake_webrtc_platform.dart';

void main() {
  late FakeSocket socket;
  late FakeWebRtcPlatform platform;

  setUp(() => platform = FakeWebRtcPlatform());
  tearDown(() => platform.dispose());

  SignalingClient clientFor({bool autoReconnect = false}) {
    socket = FakeSocket();
    return SignalingClient(
      endpoint: 'ws://localhost:4000/v1/rtc',
      token: fakeToken({'rid': 'room-1', 'sub': 'alice'}),
      roomId: 'room-1',
      autoReconnect: autoReconnect,
      socketFactory: (_) async => socket,
    );
  }

  Future<void> joinRoom(SignalingClient signaling, {List<Map<String, dynamic>>? participants}) async {
    final joining = signaling.connect();
    await Future<void>.delayed(Duration.zero);
    socket.receive({
      'type': ServerMessageType.roomJoined,
      'roomId': 'room-1',
      'participants': participants ?? const [],
    });
    await joining;
  }

  group('offer handling — the join-transition race (spec §3-4)', () {
    test('an sdp.offer that arrives right after room.joined is answered when engine.start() runs before connect()', () async {
      final signaling = clientFor();
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);

      // The fix: subscribe before the join, exactly like RavenRoom.attach.
      engine.start();
      await joinRoom(signaling);

      // The SFU's very next message, same as the live trace in the bug
      // report: sdp.offer immediately after room.joined.
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final answer = socket.lastSent(ClientMessageType.sdpAnswer);
      expect(answer, isNotNull, reason: 'the offer must be processed, not silently dropped');
      expect(answer!['sdp'], isNotEmpty);

      await engine.dispose();
      await signaling.dispose();
    });

    test('REGRESSION: signaling.messages never loses an event a subscriber attached before connect() is listening for', () async {
      // Direct proof of the mechanism, independent of RavenEngine: a
      // broadcast stream delivers nothing to a listener that did not
      // exist yet when the event was added (see room_test.dart's twin
      // test for signaling.joins, which is the deterministic half of
      // this same class of bug).
      final signaling = clientFor();
      final received = <Map<String, dynamic>>[];
      signaling.messages.listen(received.add);

      await joinRoom(signaling);
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);

      expect(received, hasLength(1));
      expect(received.single['type'], ServerMessageType.sdpOffer);
      await signaling.dispose();
    });
  });

  group('publish negotiation — the state machine (spec §9)', () {
    test('a publish attempted while the peer connection is mid-round defers instead of racing the server', () async {
      final signaling = clientFor();
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);

      // The SFU offers first, establishing the peer connection.
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(socket.lastSent(ClientMessageType.sdpAnswer), isNotNull);

      final pcId = platform.lastPeerConnectionId!;
      final media = fakeLocalMedia(pcId);

      // signalingState defaults to unknown/non-stable until the native
      // side reports otherwise (RavenEngine's own defensive read); a
      // publish attempted here must not send a competing offer.
      await engine.publish(source: 'camera', stream: media.stream, track: media.track);
      await Future<void>.delayed(Duration.zero);

      expect(
        socket.sent.where((m) => m['type'] == ClientMessageType.sdpOffer),
        isEmpty,
        reason: 'must defer rather than offer while a round could still be in flight',
      );

      // The connection settles...
      await platform.signalingState(pcId, 'stable');
      // ...and the SFU's next offer is what actually flushes the queue
      // (see _handleOffer -> _flushDeferredPublishes), exactly as the
      // adapter's own doc comment describes.
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer 2'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(
        socket.sent.where((m) => m['type'] == ClientMessageType.sdpOffer),
        isNotEmpty,
        reason: 'the queued publish negotiation must flush once the round ends',
      );

      await engine.dispose();
      await signaling.dispose();
    });
  });

  group('sendData — data-channel negotiation (spec §7)', () {
    test('a payload sent before the channel opens is queued and delivered once it does, never dropped', () async {
      final signaling = clientFor();
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final pcId = platform.lastPeerConnectionId!;

      var sent = false;
      final sending = engine.sendData([1, 2, 3]).then((_) => sent = true);

      // Not sent yet: createDataChannel resolved, but nothing has told
      // the engine the channel is open.
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(sent, isFalse, reason: 'must wait for the channel, not send into one that may not be open');

      await platform.openDataChannel(pcId);
      await sending.timeout(const Duration(seconds: 2));

      expect(sent, isTrue);
      expect(platform.calls, contains('dataChannelSend'));

      await engine.dispose();
      await signaling.dispose();
    });

    test('ensureDataChannel opens a channel for a receive-only participant who never publishes or sends', () async {
      final signaling = clientFor();
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(platform.calls, isNot(contains('createDataChannel')));

      await engine.ensureDataChannel();

      expect(platform.calls, contains('createDataChannel'));

      await engine.dispose();
      await signaling.dispose();
    });

    test('sendData() waiters are aborted, not left hanging, once signaling fails terminally', () async {
      final signaling = clientFor(autoReconnect: false);
      final engine = RavenEngine(signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final sending = engine.sendData([9]);
      // Attached immediately: an error a Future completes with before
      // anything is listening is reported as unhandled by the zone, even
      // if something awaits it a turn later.
      final expectation = expectLater(sending, throwsA(anything));
      await Future<void>.delayed(Duration.zero);

      socket.drop(1006); // ordinary drop, autoReconnect off -> failed
      await Future<void>.delayed(Duration.zero);

      await expectation;

      await engine.dispose();
      await signaling.dispose();
    });
  });
}
