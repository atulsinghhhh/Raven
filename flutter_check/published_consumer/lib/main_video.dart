import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';
import 'package:raven_rtc/raven_rtc.dart';

/// Real E2E check for **Flutter-to-Flutter** media over the *published*
/// `raven_rtc` package: a plain room join (no `raven_live`), where every
/// participant — publishers and subscribers alike — is this same Flutter
/// Web build. `flutter_check/live_host` and the effects/data harnesses
/// only ever paired a Flutter participant against a real browser
/// (`@ravenkash/rtc`); this is the one combination `flutter_check/README.md`
/// flagged as a known gap, and the one a Flutter-only integrator's app
/// actually runs in production.
///
/// Query parameters: `token`, `endpoint`, `roomId`, `iceServers` (JSON),
/// `publish` (`'true'`/`'false'`, default `false`).
///
/// Reports `window.__state`:
/// - `phase`, `connectionState`, `ready`, `error` — same vocabulary as
///   `main_live_host.dart`.
/// - `cameraPublished`/`microphonePublished` — this participant's own
///   publish outcome, straight from `enableCamera()`/`enableMicrophone()`
///   resolving without throwing.
/// - `remoteLiveSources` — `{identity: ['camera', 'microphone']}` for
///   every *other* participant, rebuilt from `room.participantChanges`
///   every time it fires. This is the field the bug report's "camera=false"
///   comes from: what one participant's engine believes another is
///   publishing, not what that other participant believes about itself.
void main() {
  _publishState({'phase': 'booting'});
  runApp(const _VideoApp());
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
  webConsoleLog('[flutter-video] ${jsonEncode(patch)}');
}

@JS('console.log')
external void webConsoleLog(String message);

class _VideoApp extends StatelessWidget {
  const _VideoApp();

  @override
  Widget build(BuildContext context) =>
      const MaterialApp(home: Scaffold(body: Center(child: _VideoRunner())));
}

class _VideoRunner extends StatefulWidget {
  const _VideoRunner();

  @override
  State<_VideoRunner> createState() => _VideoRunnerState();
}

class _VideoRunnerState extends State<_VideoRunner> {
  String _summary = 'booting';

  @override
  void initState() {
    super.initState();
    _run();
  }

  void _fail(String code, String message) {
    _publishState({
      'phase': 'failed',
      'error': {'code': code, 'message': message},
    });
    setState(() => _summary = 'failed: $code — $message');
  }

  Future<void> _run() async {
    final params = Uri.base.queryParameters;
    final token = params['token'];
    final endpoint = params['endpoint'];
    final roomId = params['roomId'];
    final iceServersRaw = params['iceServers'];
    final shouldPublish = params['publish'] == 'true';
    if (token == null || endpoint == null || roomId == null) {
      _fail('missing_params', 'Expected `token`, `endpoint` and `roomId` query parameters.');
      return;
    }

    List<RavenIceServer>? iceServers;
    if (iceServersRaw != null && iceServersRaw.isNotEmpty) {
      final decoded = jsonDecode(iceServersRaw) as List<dynamic>;
      iceServers = decoded.map((e) => RavenIceServer.fromJson(e as Map<String, dynamic>)).toList();
    }

    final raven = Raven(token: token, endpoint: endpoint, iceServers: iceServers, autoReconnect: true);

    final RavenRoom room;
    try {
      _publishState({'phase': 'joining', 'roomId': roomId});
      room = await raven.join(roomId);
    } catch (error) {
      _fail('join_failed', 'Raven.join threw: $error');
      return;
    }

    room.connectionStateChanges.listen((state) {
      _publishState({'connectionState': state.name});
    });
    room.errors.listen((error) {
      _publishState({
        'roomError': {'code': error.code.name, 'message': error.message},
      });
    });
    room.participantChanges.listen((participants) {
      final remote = participants.where((p) => !p.isLocal);
      _publishState({
        'participantIdentities': participants.map((p) => p.identity).toList(),
        'remoteLiveSources': {
          for (final p in remote)
            p.identity: [
              if (p.isCameraEnabled) 'camera',
              if (p.isMicrophoneEnabled) 'microphone',
            ],
        },
      });
    });

    _publishState({
      'phase': 'joined',
      'connectionState': room.connectionState.name,
    });

    if (shouldPublish) {
      try {
        await room.enableCamera();
        _publishState({'cameraPublished': true});
        await room.enableMicrophone();
        _publishState({'microphonePublished': true});
      } catch (error) {
        _fail('publish_failed', 'Could not publish camera/microphone: $error');
        return;
      }
    }

    _publishState({'ready': true});
    globalContext.setProperty(
      '__leave'.toJS,
      (() {
        // ignore: discarded_futures
        room.leave();
      }).toJS,
    );
    setState(() => _summary = 'ready: ${room.connectionState.name}');
  }

  @override
  Widget build(BuildContext context) => Text(_summary);
}
