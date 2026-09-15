import 'package:flutter_test/flutter_test.dart';
import 'package:raven_rtc/raven_rtc.dart';

import 'helpers/fake_socket.dart';

/// `Raven.join()`'s client-side room/token precheck (spec: matches the
/// web SDK's `assertTokenMatchesRoom` exactly).
///
/// A token names its room by *two* claims: `rid` (an internal id) and
/// `rnm` (a human name) — a live stream's RTC token, for instance, is
/// minted against its underlying room's internal id, but the value an
/// application actually has in hand to join with is the stream's own
/// public id, which is what the room's `name` was set to. Checking `rid`
/// alone (the bug this regression-tests) rejected that case outright:
/// every live stream, always, since a stream's public id is never its
/// underlying room's internal id. `port 1` is used for the "not
/// rejected" cases so a real (fast, ECONNREFUSED) connection failure
/// distinguishes itself from the precheck without waiting out the real
/// 10s open timeout.
void main() {
  const unreachableEndpoint = 'ws://127.0.0.1:1/v1/rtc';

  Matcher isRoomNotFound() => isA<RavenException>()
      .having((e) => e.code, 'code', RavenErrorCode.roomNotFound);

  group('Raven.join room/token precheck', () {
    test(
        'accepts a roomId matching the token\'s room name (rnm), not only its internal id (rid)',
        () async {
      final token = fakeToken({
        'rid': 'room-internal-uuid',
        'rnm': 'stream_public_id',
        'sub': 'alice'
      });
      final raven = Raven(token: token, endpoint: unreachableEndpoint);

      await expectLater(
          raven.join('stream_public_id'), throwsA(isNot(isRoomNotFound())));
    });

    test('accepts a roomId matching the internal id (rid) too', () async {
      final token = fakeToken({
        'rid': 'room-internal-uuid',
        'rnm': 'stream_public_id',
        'sub': 'alice'
      });
      final raven = Raven(token: token, endpoint: unreachableEndpoint);

      await expectLater(
          raven.join('room-internal-uuid'), throwsA(isNot(isRoomNotFound())));
    });

    test('rejects a roomId matching neither claim', () async {
      final token = fakeToken({
        'rid': 'room-internal-uuid',
        'rnm': 'stream_public_id',
        'sub': 'alice'
      });
      final raven = Raven(token: token, endpoint: unreachableEndpoint);

      await expectLater(
          raven.join('totally-different-room'), throwsA(isRoomNotFound()));
    });

    test(
        'skips the room-match check entirely for a token carrying neither claim',
        () async {
      final token = fakeToken({'sub': 'alice'});
      final raven = Raven(token: token, endpoint: unreachableEndpoint);

      // Not rejected as roomNotFound — but such a token names no room at
      // all, so it still can't actually join one; see the next test.
      await expectLater(
          raven.join('whatever-room'), throwsA(isNot(isRoomNotFound())));
    });

    test(
        'a token with no rid cannot join at all, even if the caller-supplied roomId matches rnm',
        () async {
      // A token naming no internal id has nothing this SDK can put on
      // the wire: the room.join message's roomId is always the token's
      // own rid (see join()'s doc comment), never the caller's string,
      // exactly like the web SDK's roomIdFromToken().
      final token = fakeToken({'rnm': 'stream_public_id', 'sub': 'alice'});
      final raven = Raven(token: token, endpoint: unreachableEndpoint);

      await expectLater(
        raven.join('stream_public_id'),
        throwsA(isA<RavenException>()
            .having((e) => e.code, 'code', RavenErrorCode.invalidToken)),
      );
    });
  });
}
