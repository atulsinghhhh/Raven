import 'package:flutter_test/flutter_test.dart';
import 'package:raven_chat/raven_chat.dart';

void main() {
  group('parseChatErrorCode via fromServer', () {
    test('maps the server codes a client branches on', () {
      final cases = <String, RavenChatErrorCode>{
        'INVALID_TOKEN': RavenChatErrorCode.invalidToken,
        'TOKEN_EXPIRED': RavenChatErrorCode.tokenExpired,
        'TOKEN_REVOKED': RavenChatErrorCode.tokenRevoked,
        'PERMISSION_DENIED': RavenChatErrorCode.permissionDenied,
        'NOT_A_MEMBER': RavenChatErrorCode.notAMember,
        'ROOM_NOT_FOUND': RavenChatErrorCode.roomNotFound,
        'MESSAGE_TOO_LARGE': RavenChatErrorCode.messageTooLarge,
        'INVALID_CURSOR': RavenChatErrorCode.invalidCursor,
        'RATE_LIMITED': RavenChatErrorCode.rateLimited,
      };

      cases.forEach((raw, expected) {
        final error =
            RavenChatException.fromServer({'code': raw, 'message': 'x'});
        expect(error.code, expected, reason: raw);
      });
    });

    test('keeps an unrecognised code visible instead of discarding it', () {
      // A newer server must widen the model, not break an app — but the
      // developer still needs to see what actually arrived.
      final error = RavenChatException.fromServer({
        'code': 'SOME_FUTURE_CODE',
        'message': 'from a newer server',
      });

      expect(error.code, RavenChatErrorCode.unknown);
      expect(error.rawCode, 'SOME_FUTURE_CODE');
      expect(error.toString(), contains('SOME_FUTURE_CODE'));
    });

    test('carries retryAfterSeconds through on a rate limit', () {
      final error = RavenChatException.fromServer({
        'code': 'RATE_LIMITED',
        'message': 'slow down',
        'retryAfterSeconds': 7,
      });

      expect(error.retryAfterSeconds, 7);
      expect(error.isRetryable, isTrue);
    });
  });

  group('isRetryable', () {
    test('is true for transient failures', () {
      for (final code in [
        RavenChatErrorCode.networkError,
        RavenChatErrorCode.timeout,
        RavenChatErrorCode.connectionClosed,
        RavenChatErrorCode.rateLimited,
        RavenChatErrorCode.internalError,
      ]) {
        expect(
          RavenChatException(code, 'x').isRetryable,
          isTrue,
          reason: code.name,
        );
      }
    });

    test('is false for failures that would fail identically forever', () {
      // Retrying a rejected token or an oversized message just wastes
      // battery and hammers the server.
      for (final code in [
        RavenChatErrorCode.invalidToken,
        RavenChatErrorCode.tokenRevoked,
        RavenChatErrorCode.permissionDenied,
        RavenChatErrorCode.messageTooLarge,
        RavenChatErrorCode.notAMember,
      ]) {
        expect(
          RavenChatException(code, 'x').isRetryable,
          isFalse,
          reason: code.name,
        );
      }
    });
  });
}
