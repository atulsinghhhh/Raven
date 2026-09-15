import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';
import 'package:raven_chat/raven_chat.dart';
import 'package:raven_live/raven_live.dart';
import 'package:raven_rtc/raven_rtc.dart';

/// Section 9 of the pub.dev consumer validation: one Flutter app that
/// imports `raven_rtc`, `raven_live` *and* `raven_chat` together, from
/// pub.dev, and drives a real flow through each. The point isn't new
/// coverage of any single package (sections 4-6 already do that) — it's
/// proving the three published packages resolve and run side by side in
/// one isolate with no symbol collision, no conflicting transitive
/// dependency version, and no surprising interaction between raven_live
/// (which itself depends on raven_rtc + raven_chat) and directly-used
/// raven_rtc/raven_chat in the same app.
///
/// Query parameters: `creds` (a live-stream host/viewer credential body,
/// same shape as main_live_host.dart) and `chatToken`/`chatApiUrl`/
/// `chatRoom`. Both flows run concurrently; state is reported under
/// `window.__state.live` and `window.__state.chat` respectively.
void main() {
  _publishState({
    'phase': 'booting',
    'importedPackages': ['raven_rtc', 'raven_live', 'raven_chat'],
  });
  runApp(const _CombinedApp());
}

final _stateKeys = <String>{};

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
  webConsoleLog('[flutter-combined] ${jsonEncode(patch)}');
}

void _publishNested(String section, Map<String, Object?> patch) {
  final existing = globalContext.getProperty('__state'.toJS) as JSObject?;
  final currentSection =
      (existing?.getProperty(section.toJS)?.dartify() as Map<dynamic, dynamic>?)?.cast<String, Object?>() ??
          <String, Object?>{};
  _publishState({section: {...currentSection, ...patch}});
}

@JS('console.log')
external void webConsoleLog(String message);

class _CombinedApp extends StatelessWidget {
  const _CombinedApp();

  @override
  Widget build(BuildContext context) => const MaterialApp(home: Scaffold(body: Center(child: _CombinedRunner())));
}

class _CombinedRunner extends StatefulWidget {
  const _CombinedRunner();

  @override
  State<_CombinedRunner> createState() => _CombinedRunnerState();
}

class _CombinedRunnerState extends State<_CombinedRunner> {
  String _summary = 'booting';

  @override
  void initState() {
    super.initState();
    unawaited(_runChat());
    unawaited(_runLive());
  }

  Future<void> _runChat() async {
    final params = Uri.base.queryParameters;
    final token = params['chatToken'];
    final apiUrl = params['chatApiUrl'];
    final room = params['chatRoom'];
    if (token == null || apiUrl == null || room == null) {
      _publishNested('chat', {'phase': 'skipped', 'reason': 'no chatToken/chatApiUrl/chatRoom provided'});
      return;
    }

    final chat = RavenChat(token: token, apiUrl: apiUrl);
    chat.connectionStateChanges.listen((s) => _publishNested('chat', {'connectionState': s.name}));
    chat.messages.listen((m) => _publishNested('chat', {'lastMessage': {'id': m.id, 'text': m.text}}));

    globalContext.setProperty(
      '__doChatSend'.toJS,
      ((JSString text) {
        // ignore: discarded_futures
        chat.send(text.toDart).then(
              (m) => _publishNested('chat', {'lastSent': {'id': m.id, 'text': m.text}}),
              onError: (Object e) => _publishNested('chat', {'sendError': e.toString()}),
            );
      }).toJS,
    );

    try {
      _publishNested('chat', {'phase': 'connecting', 'room': room});
      await chat.connect(room);
      _publishNested('chat', {'phase': 'ready', 'ready': true, 'connectionState': chat.connectionState.name});
    } catch (error) {
      _publishNested('chat', {'phase': 'failed', 'error': error.toString()});
    }
  }

  Future<void> _runLive() async {
    final raw = Uri.base.queryParameters['creds'];
    if (raw == null) {
      _publishNested('live', {'phase': 'skipped', 'reason': 'no creds provided'});
      setState(() => _summary = 'chat-only');
      return;
    }

    Map<String, dynamic> json;
    try {
      json = jsonDecode(raw) as Map<String, dynamic>;
    } catch (error) {
      _publishNested('live', {'phase': 'failed', 'error': 'bad_creds_json: $error'});
      return;
    }
    json.remove('chat');
    json.remove('chatRootMessageId');

    final RavenLiveStreamCredentials credentials;
    try {
      credentials = RavenLiveStreamCredentials.fromJson(json);
    } catch (error) {
      _publishNested('live', {'phase': 'failed', 'error': 'bad_credentials: $error'});
      return;
    }

    _publishNested('live', {'phase': 'joining', 'streamId': credentials.streamId, 'role': credentials.role.name});

    final RavenLiveStream stream;
    try {
      stream = await RavenLiveStream.join(credentials);
    } catch (error) {
      _publishNested('live', {'phase': 'failed', 'error': 'join_failed: $error'});
      return;
    }

    stream.room.connectionStateChanges.listen((s) => _publishNested('live', {'connectionState': s.name}));

    _publishNested('live', {
      'phase': 'joined',
      'connectionState': stream.room.connectionState.name,
      'isHost': stream.isHost,
    });

    if (stream.isHost) {
      try {
        await stream.room.enableCamera();
        await stream.room.enableMicrophone();
        _publishNested('live', {'cameraPublished': true, 'microphonePublished': true});
      } catch (error) {
        _publishNested('live', {'phase': 'failed', 'error': 'publish_failed: $error'});
        return;
      }
    }

    _publishNested('live', {'ready': true});
    globalContext.setProperty(
      '__leaveLive'.toJS,
      (() {
        // ignore: discarded_futures
        stream.leave();
      }).toJS,
    );
    setState(() => _summary = 'combined ready: rtc+live+chat imported and running together');
  }

  @override
  Widget build(BuildContext context) => Text(_summary);
}

void unawaited(Future<void> future) {}
