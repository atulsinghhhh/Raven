import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';
import 'package:raven_live/raven_live.dart';
import 'package:raven_rtc/raven_rtc.dart';

/// Real end-to-end check for `raven_live` on Flutter Web: this is the
/// Flutter host side of "Flutter Host -> Browser Viewer" (see
/// apps/api/test/flutter-live-streaming.e2e-spec.ts). Not a demo app —
/// its only job is to join a real live stream through the real,
/// currently-checked-out `raven_live`/`raven_rtc` and report every state
/// transition to `window.__state`, exactly like the JS
/// `apps/api/test/e2e-harness/*.js` harnesses do, so the driving test can
/// poll it with Playwright the same way.
///
/// Credentials arrive as a single URL query parameter, `creds`: the raw
/// JSON body `POST /v1/live-streams/:id/hosts` returned, percent-encoded.
/// `chat` is stripped before parsing — this check is scoped to RTC media,
/// not chat, and a chat-connect failure must not be indistinguishable
/// from an RTC failure.
void main() {
  _publishState({'phase': 'booting'});
  runApp(const _HostApp());
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
  // Mirrors to the console too: Playwright's page-diagnostics helper
  // collects console output, and a check that fails with nothing but a
  // stuck poll is not diagnosable.
  webConsoleLog('[flutter-host] ${jsonEncode(patch)}');
}

// Every key __state has ever had, so re-publishing a partial patch does
// not drop fields a previous patch set — window.__state is meant to be
// read as a growing snapshot, the same contract the JS harnesses use.
final _stateKeys = <String>{};

@JS('console.log')
external void webConsoleLog(String message);

class _HostApp extends StatelessWidget {
  const _HostApp();

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      home: Scaffold(body: Center(child: _HostRunner())),
    );
  }
}

class _HostRunner extends StatefulWidget {
  const _HostRunner();

  @override
  State<_HostRunner> createState() => _HostRunnerState();
}

class _HostRunnerState extends State<_HostRunner> {
  String _summary = 'booting';

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    final raw = Uri.base.queryParameters['creds'];
    if (raw == null) {
      _fail('missing_creds', 'No `creds` query parameter was provided.');
      return;
    }

    Map<String, dynamic> json;
    try {
      json = jsonDecode(raw) as Map<String, dynamic>;
    } catch (error) {
      _fail('bad_creds_json', 'Could not parse `creds` as JSON: $error');
      return;
    }
    // RTC-only for this check; see the module doc.
    json.remove('chat');
    json.remove('chatRootMessageId');

    final RavenLiveStreamCredentials credentials;
    try {
      credentials = RavenLiveStreamCredentials.fromJson(json);
    } catch (error) {
      _fail('bad_credentials', 'RavenLiveStreamCredentials.fromJson failed: $error');
      return;
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
      _fail('join_failed', 'RavenLiveStream.join threw: $error');
      return;
    }
    stream.room.connectionStateChanges.listen((state) {
      _publishState({'connectionState': state.name});
    });
    stream.room.errors.listen((error) {
      _publishState({'roomError': {'code': error.code.name, 'message': error.message}});
    });
    stream.room.participantChanges.listen((participants) {
      final remote = participants.where((p) => !p.isLocal);
      _publishState({
        'participantIdentities': participants.map((p) => p.identity).toList(),
        // For a viewer: which track kinds are actually subscribed and
        // live, not merely that a participant object exists.
        'remoteLiveSources': {
          for (final p in remote)
            p.identity: [
              if (p.isCameraEnabled) 'camera',
              if (p.isMicrophoneEnabled) 'microphone',
              if (p.isScreenSharing) 'screenShare',
            ],
        },
      });
    });

    _publishState({
      'phase': 'joined',
      'connectionState': stream.room.connectionState.name,
      'isHost': stream.isHost,
    });

    if (stream.isHost) {
      try {
        await stream.room.enableCamera();
        _publishState({'cameraPublished': true});
        await stream.room.enableMicrophone();
        _publishState({'microphonePublished': true});
      } catch (error) {
        _fail('publish_failed', 'Could not publish camera/microphone: $error');
        return;
      }

      // RavenRoom has no waitUntilConnected() (that's a web-SDK-only
      // method — not invented here): wait on connectionStateChanges
      // directly, since it already reflects `connected` once media is up.
      if (stream.room.connectionState != RavenConnectionState.connected) {
        try {
          await stream.room.connectionStateChanges
              .firstWhere((state) => state == RavenConnectionState.connected)
              .timeout(const Duration(seconds: 20));
        } catch (error) {
          _publishState({'connectError': error.toString()});
        }
      }
      _publishState({'connectionState': stream.room.connectionState.name});
    }

    _publishState({'ready': true});
    globalContext.setProperty(
      '__leave'.toJS,
      (() {
        // ignore: discarded_futures
        stream.leave().then((_) => _publishState({'phase': 'left'}));
      }).toJS,
    );

    setState(() => _summary = 'ready: ${stream.room.connectionState.name}');
  }

  void _fail(String code, String message) {
    _publishState({'phase': 'failed', 'error': {'code': code, 'message': message}});
    setState(() => _summary = 'failed: $code — $message');
  }

  @override
  Widget build(BuildContext context) => Text(_summary);
}
