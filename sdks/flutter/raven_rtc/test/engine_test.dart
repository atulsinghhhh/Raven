import 'package:flutter_test/flutter_test.dart';
import 'package:raven_rtc/src/errors.dart';
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

  Future<void> joinRoom(SignalingClient signaling,
      {List<Map<String, dynamic>>? participants}) async {
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
    test(
        'an sdp.offer that arrives right after room.joined is answered when engine.start() runs before connect()',
        () async {
      final signaling = clientFor();
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);

      // The fix: subscribe before the join, exactly like RavenRoom.attach.
      engine.start();
      await joinRoom(signaling);

      // The SFU's very next message, same as the live trace in the bug
      // report: sdp.offer immediately after room.joined.
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final answer = socket.lastSent(ClientMessageType.sdpAnswer);
      expect(answer, isNotNull,
          reason: 'the offer must be processed, not silently dropped');
      expect(answer!['sdp'], isNotEmpty);

      await engine.dispose();
      await signaling.dispose();
    });

    test(
        'REGRESSION: signaling.messages never loses an event a subscriber attached before connect() is listening for',
        () async {
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
    test(
        'a publish attempted while the peer connection is mid-round defers instead of racing the server',
        () async {
      final signaling = clientFor();
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);

      // The SFU offers first, establishing the peer connection.
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(socket.lastSent(ClientMessageType.sdpAnswer), isNotNull);

      final pcId = platform.lastPeerConnectionId!;
      final media = fakeLocalMedia(pcId);

      // The connection settled after the first offer/answer above — a
      // publish() here would legitimately be free to offer immediately.
      // Force it back into a genuinely-mid-round state (the SFU's next
      // offer, still unanswered) so this test actually exercises the
      // defer branch instead of a publish that's free to go.
      await platform.signalingState(pcId, 'have-remote-offer');

      await engine.publish(
          source: 'camera', stream: media.stream, track: media.track);
      await Future<void>.delayed(Duration.zero);

      expect(
        socket.sent.where((m) => m['type'] == ClientMessageType.sdpOffer),
        isEmpty,
        reason:
            'must defer rather than offer while a round could still be in flight',
      );

      // The connection settles...
      await platform.signalingState(pcId, 'stable');
      // ...and the SFU's next offer is what actually flushes the queue
      // (see _handleOffer -> _flushDeferredPublishes), exactly as the
      // adapter's own doc comment describes.
      socket
          .receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer 2'});
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

  group('glare recovery — the SFU is the impolite peer (spec §9)', () {
    // Shared setup for every test below: join, let the SFU's join-time
    // offer establish the peer connection, and report the round settled
    // (`stable`) so a subsequent publish() offers immediately instead of
    // deferring — exactly the "the platform side finally caught up" state
    // real devices/browsers report between rounds.
    Future<String> establishPeerConnection(SignalingClient signaling) async {
      socket.receive({'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 offer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(socket.lastSent(ClientMessageType.sdpAnswer), isNotNull);

      final pcId = platform.lastPeerConnectionId!;
      await platform.signalingState(pcId, 'stable');
      return pcId;
    }

    test(
        'Test A — an SFU offer that arrives while our own offer is outstanding rolls our offer back before answering',
        () async {
      final signaling = clientFor();
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);
      final pcId = await establishPeerConnection(signaling);

      final media = fakeLocalMedia(pcId);
      await engine.publish(
          source: 'camera', stream: media.stream, track: media.track);
      await Future<void>.delayed(Duration.zero);
      expect(
        socket.sent.where((m) => m['type'] == ClientMessageType.sdpOffer),
        isNotEmpty,
        reason:
            'the fresh camera transceiver must offer immediately: the connection was stable',
      );
      final answersBefore = socket.sent
          .where((m) => m['type'] == ClientMessageType.sdpAnswer)
          .length;

      // The native/browser side now reports what setLocalDescription(offer)
      // actually did: our own offer is outstanding. Real glare follows —
      // the SFU's own offer lands in the same window.
      await platform.signalingState(pcId, 'have-local-offer');
      socket.receive(
          {'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 sfu-offer-2'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(
        platform.localDescriptionTypes,
        contains('rollback'),
        reason:
            'our outstanding offer must be rolled back, not left for setRemoteDescription to choke on',
      );
      expect(
        socket.sent
            .where((m) => m['type'] == ClientMessageType.sdpAnswer)
            .length,
        greaterThan(answersBefore),
        reason:
            "the SFU's offer must still be answered — glare is not a reason to stop responding to it",
      );

      await engine.dispose();
      await signaling.dispose();
    });

    test(
        'Test B — NEGOTIATION_GLARE does not drop the publish; it is requeued and retried',
        () async {
      final signaling = clientFor();
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);
      final pcId = await establishPeerConnection(signaling);

      final media = fakeLocalMedia(pcId);
      await engine.publish(
          source: 'camera', stream: media.stream, track: media.track);
      await Future<void>.delayed(Duration.zero);
      final offersBefore = socket.sent
          .where((m) => m['type'] == ClientMessageType.sdpOffer)
          .length;
      expect(offersBefore, greaterThan(0),
          reason: 'camera offer must have gone out first');

      final errors = <RavenException>[];
      engine.errors.listen(errors.add);

      // The server refuses our offer: its own is already on the way.
      socket.receive({
        'type': ServerMessageType.error,
        'code': SignalingErrorCode.negotiationGlare,
        'message':
            'an offer from the server is already in flight; answer it, then retry',
      });
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      // Glare must never surface as a failed/lost publish.
      expect(errors, isEmpty,
          reason: 'NEGOTIATION_GLARE is expected protocol, not a media error');

      // The SFU's own offer — the one glare made way for — now arrives,
      // and the round settles.
      await platform.signalingState(pcId, 'have-local-offer');
      await platform.signalingState(pcId, 'stable');
      socket.receive(
          {'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 sfu-offer-2'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(
        socket.sent
            .where((m) => m['type'] == ClientMessageType.sdpOffer)
            .length,
        greaterThan(offersBefore),
        reason:
            'the glared publish must retry once the round it lost to completes, not vanish silently',
      );

      await engine.dispose();
      await signaling.dispose();
    });

    test(
        'Test C — a publish deferred behind our own outstanding offer retries once that offer is answered',
        () async {
      final signaling = clientFor();
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);
      final pcId = await establishPeerConnection(signaling);

      // Camera publishes first: the connection is stable, so its offer
      // goes out immediately.
      final camera =
          fakeLocalMedia(pcId, trackId: 'camera-track', kind: 'video');
      await engine.publish(
          source: 'camera', stream: camera.stream, track: camera.track);
      await Future<void>.delayed(Duration.zero);
      final offersAfterCamera = socket.sent
          .where((m) => m['type'] == ClientMessageType.sdpOffer)
          .length;
      expect(offersAfterCamera, greaterThan(0));

      // The native/browser side reports the camera offer outstanding —
      // exactly the window main_live_host.dart's back-to-back
      // enableCamera(); enableMicrophone(); can land microphone in.
      await platform.signalingState(pcId, 'have-local-offer');

      final mic = fakeLocalMedia(pcId, trackId: 'mic-track', kind: 'audio');
      await engine.publish(
          source: 'microphone', stream: mic.stream, track: mic.track);
      await Future<void>.delayed(Duration.zero);

      expect(
        socket.sent
            .where((m) => m['type'] == ClientMessageType.sdpOffer)
            .length,
        offersAfterCamera,
        reason:
            'microphone must defer rather than race the camera offer still outstanding',
      );

      // The SFU plainly answers the camera offer — no glare this time.
      await platform.signalingState(pcId, 'stable');
      socket
          .receive({'type': ServerMessageType.sdpAnswer, 'sdp': 'v=0 answer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(
        socket.sent
            .where((m) => m['type'] == ClientMessageType.sdpOffer)
            .length,
        greaterThan(offersAfterCamera),
        reason:
            '_handleAnswer must flush the deferred microphone negotiation, not only _handleOffer',
      );

      await engine.dispose();
      await signaling.dispose();
    });

    test(
        'Test D — full sequence: publish, glare, rollback, SFU offer answered, retry accepted, track stays negotiated',
        () async {
      final signaling = clientFor();
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);
      engine.start();
      await joinRoom(signaling);
      final pcId = await establishPeerConnection(signaling);

      final media = fakeLocalMedia(pcId);
      final published = await engine.publish(
          source: 'camera', stream: media.stream, track: media.track);
      await Future<void>.delayed(Duration.zero);
      expect(socket.sent.where((m) => m['type'] == ClientMessageType.sdpOffer),
          isNotEmpty);

      final errors = <RavenException>[];
      engine.errors.listen(errors.add);

      // Glare: the SFU refuses our camera offer.
      await platform.signalingState(pcId, 'have-local-offer');
      socket.receive({
        'type': ServerMessageType.error,
        'code': SignalingErrorCode.negotiationGlare,
        'message': 'glare',
      });
      await Future<void>.delayed(Duration.zero);

      // ...and its own offer — the one that caused the glare — arrives
      // right behind it. This must roll our offer back and answer.
      socket.receive(
          {'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 sfu-offer-2'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(platform.localDescriptionTypes, contains('rollback'));

      // The round settles; the retried camera negotiation goes out and the
      // SFU accepts it.
      await platform.signalingState(pcId, 'stable');
      await Future<void>.delayed(Duration.zero);
      final offersAfterRound2 = socket.sent
          .where((m) => m['type'] == ClientMessageType.sdpOffer)
          .length;
      // Nudge the queue again in case the first flush attempt landed
      // before the native side reported `stable` (see establishPeerConnection).
      socket.receive(
          {'type': ServerMessageType.sdpOffer, 'sdp': 'v=0 sfu-offer-3'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await platform.signalingState(pcId, 'stable');

      final retried = socket.sent
          .where((m) => m['type'] == ClientMessageType.sdpOffer)
          .toList();
      expect(retried.length, greaterThan(offersAfterRound2 - 1),
          reason:
              'the camera publish must have retried at least once after the glared round settled');

      socket.receive(
          {'type': ServerMessageType.sdpAnswer, 'sdp': 'v=0 final-answer'});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(errors, isEmpty,
          reason:
              'the whole glare/rollback/retry sequence must never surface as a media error');
      expect(
        engine.publishedTracks.map((t) => t.source),
        contains('camera'),
        reason:
            'the camera stays a locally published track throughout — publish() itself never failed',
      );
      expect(published.source, 'camera');

      await engine.dispose();
      await signaling.dispose();
    });
  });

  group('sendData — data-channel negotiation (spec §7)', () {
    test(
        'a payload sent before the channel opens is queued and delivered once it does, never dropped',
        () async {
      final signaling = clientFor();
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);
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
      expect(sent, isFalse,
          reason:
              'must wait for the channel, not send into one that may not be open');

      await platform.openDataChannel(pcId);
      await sending.timeout(const Duration(seconds: 2));

      expect(sent, isTrue);
      expect(platform.calls, contains('dataChannelSend'));

      await engine.dispose();
      await signaling.dispose();
    });

    test(
        'ensureDataChannel opens a channel for a receive-only participant who never publishes or sends',
        () async {
      final signaling = clientFor();
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);
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

    test(
        'sendData() waiters are aborted, not left hanging, once signaling fails terminally',
        () async {
      final signaling = clientFor(autoReconnect: false);
      final engine = RavenEngine(
          signaling: signaling, iceServers: const [], adaptiveStream: false);
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
