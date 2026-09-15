import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';
import 'package:raven_rtc/raven_rtc.dart';

/// Real E2E check for the *published* `raven_rtc` package's data channel
/// and reconnect behavior: a plain room join (no `raven_live`), two
/// participants, `sendData`/`data` over a real SFU-relayed data channel,
/// and a real network drop (Playwright `context.setOffline`) to exercise
/// `Raven`'s `autoReconnect`. Not a demo — same `window.__state` /
/// JS-bridge remote-control pattern as `main_chat.dart`/`main_live_host.dart`.
///
/// Query parameters: `token`, `endpoint`, `roomId`, `iceServers` (JSON).
void main() {
  _publishState({'phase': 'booting'});
  runApp(const _DataApp());
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
  webConsoleLog('[flutter-data] ${jsonEncode(patch)}');
}

void _appendState(String listKey, Object? item) {
  final existing = globalContext.getProperty('__state'.toJS) as JSObject?;
  final currentList = existing?.getProperty(listKey.toJS)?.dartify() as List<dynamic>?;
  _publishState({listKey: [...(currentList ?? const []), item]});
}

@JS('console.log')
external void webConsoleLog(String message);

class _DataApp extends StatelessWidget {
  const _DataApp();

  @override
  Widget build(BuildContext context) => const MaterialApp(home: Scaffold(body: Center(child: _DataRunner())));
}

class _DataRunner extends StatefulWidget {
  const _DataRunner();

  @override
  State<_DataRunner> createState() => _DataRunnerState();
}

class _DataRunnerState extends State<_DataRunner> {
  String _summary = 'booting';

  @override
  void initState() {
    super.initState();
    _run();
  }

  void _fail(String code, String message) {
    _publishState({'phase': 'failed', 'error': {'code': code, 'message': message}});
    setState(() => _summary = 'failed: $code — $message');
  }

  Future<void> _run() async {
    final params = Uri.base.queryParameters;
    final token = params['token'];
    final endpoint = params['endpoint'];
    final roomId = params['roomId'];
    final iceServersRaw = params['iceServers'];
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
      _appendState('connectionStateHistory', state.name);
    });
    room.errors.listen((error) => _appendState('errors', {'code': error.code.name, 'message': error.message}));
    room.data.listen((bytes) {
      _appendState('receivedData', utf8.decode(bytes, allowMalformed: true));
    });

    globalContext.setProperty(
      '__doSendData'.toJS,
      ((JSString text) {
        // ignore: discarded_futures
        room.sendData(utf8.encode(text.toDart)).then(
              (_) => _appendState('sentData', text.toDart),
              onError: (Object e) => _publishState({'sendDataError': e.toString()}),
            );
      }).toJS,
    );

    _publishState({
      'phase': 'joined',
      'ready': true,
      'connectionState': room.connectionState.name,
    });
    setState(() => _summary = 'ready: ${room.connectionState.name}');
  }

  @override
  Widget build(BuildContext context) => Text(_summary);
}
