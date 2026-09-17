import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';
import 'package:raven_live/raven_live.dart';
import 'package:raven_rtc/raven_rtc.dart';

/// Live Streaming end-to-end check that goes one boundary further than
/// `main.dart`: it renders every participant through a real
/// [RavenVideoView], the widget an application actually uses, so a viewer
/// that decodes RTP but never paints a frame is distinguishable from one
/// that works. `main.dart` asserts on engine flags and `getStats`, which
/// both look identical in that case.
///
/// The driving test reads the DOM `<video>` elements the renderer backs,
/// not `__state` alone — see apps/api dbg_live_render.mjs.
void main() {
  _publishState({'phase': 'booting'});
  runApp(const _App());
}

void _publishState(Map<String, Object?> patch) {
  final existing = globalContext.getProperty('__state'.toJS) as JSObject?;
  final merged = <String, Object?>{};
  if (existing != null) {
    for (final key in _stateKeys) {
      final value = existing.getProperty(key.toJS);
      if (value != null) merged[key] = value.dartify();
    }
  }
  merged.addAll(patch);
  for (final key in patch.keys) {
    if (!_stateKeys.contains(key)) _stateKeys.add(key);
  }
  globalContext.setProperty('__state'.toJS, merged.jsify());
  webConsoleLog('[flutter-host] ${jsonEncode(patch)}');
}

final _stateKeys = <String>{};

@JS('console.log')
external void webConsoleLog(String message);

class _App extends StatelessWidget {
  const _App();
  @override
  Widget build(BuildContext context) =>
      const MaterialApp(home: Scaffold(body: _Runner()));
}

class _Runner extends StatefulWidget {
  const _Runner();
  @override
  State<_Runner> createState() => _RunnerState();
}

class _RunnerState extends State<_Runner> {
  RavenLiveStream? _stream;
  String _summary = 'booting';

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    final raw = Uri.base.queryParameters['creds'];
    if (raw == null) return _fail('missing_creds', 'No `creds`.');

    final Map<String, dynamic> json;
    try {
      json = jsonDecode(raw) as Map<String, dynamic>;
    } catch (error) {
      return _fail('bad_creds_json', '$error');
    }
    if (Uri.base.queryParameters['withchat'] != '1') {
      json.remove('chat');
      json.remove('chatRootMessageId');
    }

    final RavenLiveStreamCredentials credentials;
    try {
      credentials = RavenLiveStreamCredentials.fromJson(json);
    } catch (error) {
      return _fail('bad_credentials', '$error');
    }

    _publishState({
      'phase': 'joining',
      'streamId': credentials.streamId,
      'role': credentials.role.name,
    });

    final RavenLiveStream stream;
    try {
      stream = await RavenLiveStream.join(credentials);
    } catch (error) {
      return _fail('join_failed', '$error');
    }

    stream.room.participantChanges.listen((participants) {
      _publishState({
        'participantIdentities':
            participants.map((p) => p.identity).toList(growable: false),
        'remoteLiveSources': {
          for (final p in participants.where((p) => !p.isLocal))
            p.identity: [
              if (p.isCameraEnabled) 'camera',
              if (p.isMicrophoneEnabled) 'microphone',
            ],
        },
      });
    });

    setState(() => _stream = stream);
    _publishState({'phase': 'joined', 'isHost': stream.isHost});

    if (stream.isHost) {
      try {
        await stream.room.enableCamera();
        _publishState({'cameraPublished': true});
        await stream.room.enableMicrophone();
        _publishState({'microphonePublished': true});
      } catch (error) {
        return _fail('publish_failed', '$error');
      }
    }

    _publishState({'ready': true});
    setState(() => _summary = 'ready');
  }

  void _fail(String code, String message) {
    _publishState({
      'phase': 'failed',
      'error': {'code': code, 'message': message},
    });
    setState(() => _summary = 'failed: $code — $message');
  }

  @override
  Widget build(BuildContext context) {
    final stream = _stream;
    if (stream == null) return Center(child: Text(_summary));
    // Idiomatic usage: the application rebuilds its tiles from the room's
    // own notifications, exactly as the package documents.
    return ListenableBuilder(
      listenable: stream.room,
      builder: (context, _) => Column(
        children: [
          for (final participant in stream.room.participants)
            SizedBox(
              width: 320,
              height: 180,
              child: RavenVideoView(
                key: ValueKey(participant.identity),
                participant: participant,
                room: stream.room,
              ),
            ),
        ],
      ),
    );
  }
}
