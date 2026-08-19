import 'package:flutter_test/flutter_test.dart';
import 'package:raven_live/raven_live.dart';

void main() {
  group('ravenLiveStreamRoleFromJson', () {
    test('parses every known role', () {
      expect(RavenLiveStreamCredentials.fromJson(_credentials(role: 'HOST')).role,
          RavenLiveStreamRole.host);
      expect(
          RavenLiveStreamCredentials.fromJson(_credentials(role: 'CO_HOST'))
              .role,
          RavenLiveStreamRole.coHost);
      expect(
          RavenLiveStreamCredentials.fromJson(_credentials(role: 'VIEWER'))
              .role,
          RavenLiveStreamRole.viewer);
    });

    test('throws on an unrecognised role rather than defaulting silently',
        () {
      expect(
        () => RavenLiveStreamCredentials.fromJson(_credentials(role: 'ADMIN')),
        throwsArgumentError,
      );
    });
  });

  group('RavenLiveStreamRoleX.isHost', () {
    test('is true for host and co-host, false for viewer', () {
      expect(RavenLiveStreamRole.host.isHost, isTrue);
      expect(RavenLiveStreamRole.coHost.isHost, isTrue);
      expect(RavenLiveStreamRole.viewer.isHost, isFalse);
    });
  });

  group('RavenLiveStreamCredentials.fromJson', () {
    test('parses RTC-only credentials with no chat attached', () {
      final credentials = RavenLiveStreamCredentials.fromJson({
        'streamId': 'stream_abc',
        'role': 'VIEWER',
        'rtc': {'token': 'rtc-token', 'endpoint': 'wss://rtc.example.com'},
      });

      expect(credentials.streamId, 'stream_abc');
      expect(credentials.rtc.token, 'rtc-token');
      expect(credentials.rtc.endpoint, 'wss://rtc.example.com');
      expect(credentials.rtc.iceServers, isNull);
      expect(credentials.chat, isNull);
      expect(credentials.chatRootMessageId, isNull);
    });

    test('parses ICE servers when present', () {
      final credentials = RavenLiveStreamCredentials.fromJson({
        'streamId': 'stream_abc',
        'role': 'HOST',
        'rtc': {
          'token': 'rtc-token',
          'endpoint': 'wss://rtc.example.com',
          'iceServers': [
            {'urls': 'stun:stun.example.com:19302'},
            {
              'urls': 'turn:turn.example.com:3478',
              'username': 'u',
              'credential': 'c',
            },
          ],
        },
      });

      expect(credentials.rtc.iceServers, hasLength(2));
      expect(credentials.rtc.iceServers!.last.username, 'u');
      expect(credentials.rtc.iceServers!.last.credential, 'c');
    });

    test('parses chat credentials and chatRootMessageId when attached', () {
      final credentials = RavenLiveStreamCredentials.fromJson({
        'streamId': 'stream_abc',
        'role': 'HOST',
        'rtc': {'token': 'rtc-token', 'endpoint': 'wss://rtc.example.com'},
        'chat': {
          'token': 'chat-token',
          'apiUrl': 'https://api.example.com',
          'conversations': ['conv_1'],
        },
        'chatRootMessageId': 'msg_root',
      });

      expect(credentials.chat, isNotNull);
      expect(credentials.chat!.token, 'chat-token');
      expect(credentials.chat!.apiUrl, 'https://api.example.com');
      expect(credentials.chat!.conversations, ['conv_1']);
      expect(credentials.chatRootMessageId, 'msg_root');
    });

    test('defaults conversations to an empty list rather than throwing', () {
      final credentials = RavenLiveStreamCredentials.fromJson({
        'streamId': 'stream_abc',
        'role': 'VIEWER',
        'rtc': {'token': 'rtc-token', 'endpoint': 'wss://rtc.example.com'},
        'chat': {'token': 'chat-token', 'apiUrl': 'https://api.example.com'},
      });

      expect(credentials.chat!.conversations, isEmpty);
    });
  });
}

Map<String, dynamic> _credentials({required String role}) => {
      'streamId': 'stream_abc',
      'role': role,
      'rtc': {'token': 'rtc-token', 'endpoint': 'wss://rtc.example.com'},
    };
