import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:raven_live/raven_live.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' as rtc;
import 'package:raven_rtc/raven_rtc.dart';

/// Native (Android) reproduction harness for the live-stream media path.
///
/// Same logic as the Web check, minus `dart:js_interop`: state goes to
/// stdout, which logcat carries, because there is no `window.__state` to
/// poll on a device. Credentials arrive as `--dart-define=CREDS=<json>`.
///
/// Renders through a real [RavenVideoView] and reports [RavenRoom.mediaState]
/// — the peer connection's own view — separately from the signaling
/// connection state, because the failure being chased has those two
/// disagreeing: signaling connected, media failed.
const _creds = String.fromEnvironment('CREDS');

void main() {
  runApp(const _App());
}

void _log(Object? what) => debugPrint('[LIVETEST] ${jsonEncode(what)}');

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

  /// A renderer the harness owns, attached to the first remote video track
  /// it sees. `RavenVideoView` has its own renderer inside it; this one
  /// exists so the test can read `srcObject` and the decoded frame size
  /// back out, which is the only way to tell "a track object exists" from
  /// "frames are actually arriving and decoding" on a device.
  final _probe = rtc.RTCVideoRenderer();
  bool _probeReady = false;
  String? _probeTrackId;

  Future<void> _initProbe() async {
    await _probe.initialize();
    if (mounted) setState(() => _probeReady = true);
  }

  void _attachProbe(RavenRoom room) {
    if (!_probeReady) return;
    for (final p in room.remoteParticipants) {
      final track = p.videoTrackFor(RavenTrackKind.camera);
      if (track == null) continue;
      if (_probeTrackId == track.trackId) return;
      _probeTrackId = track.trackId;
      _probe.srcObject = track.stream;
      _log({'probeAttached': p.identity, 'trackId': track.trackId});
      return;
    }
  }

  @override
  void initState() {
    super.initState();
    unawaited(_initProbe());
    _run();
  }

  Future<void> _run() async {
    _log({'phase': 'booting', 'credsLength': _creds.length});
    if (_creds.isEmpty) {
      _log({'error': 'no CREDS dart-define'});
      return;
    }

    final json = jsonDecode(_creds) as Map<String, dynamic>;
    // The chat half is kept: the real path an application takes.
    final credentials = RavenLiveStreamCredentials.fromJson(json);

    // The single most common way a live stream differs from a call in a
    // real integration: whether the ICE servers survived the trip through
    // the application's own token server.
    _log({
      'phase': 'credentials',
      'streamId': credentials.streamId,
      'role': credentials.role.name,
      'iceServerCount': credentials.rtc.iceServers?.length ?? 0,
      'iceUrls': credentials.rtc.iceServers?.map((s) => s.urls).toList() ?? [],
      'endpoint': Uri.parse(credentials.rtc.endpoint).host,
      'hasChat': credentials.chat != null,
    });

    final RavenLiveStream stream;
    try {
      stream = await RavenLiveStream.join(credentials);
    } catch (error) {
      _log({'phase': 'join_failed', 'error': '$error'});
      return;
    }
    _log({'phase': 'joined', 'isHost': stream.isHost});

    stream.room.connectionStateChanges
        .listen((s) => _log({'signaling': s.name}));
    stream.room.mediaStateChanges.listen((s) => _log({'media': s.name}));
    stream.room.errors.listen(
        (e) => _log({'roomError': e.code.name, 'message': e.message}));
    stream.room.participantChanges.listen((ps) => _log({
          'participants': ps.map((p) => p.identity).toList(),
          'remoteLive': {
            for (final p in ps.where((p) => !p.isLocal))
              p.identity: [
                if (p.isCameraEnabled) 'camera',
                if (p.isMicrophoneEnabled) 'mic',
              ],
          },
        }));

    setState(() => _stream = stream);

    if (stream.isHost) {
      try {
        await stream.room.enableCamera();
        _log({'phase': 'camera_published'});
        await stream.room.enableMicrophone();
        _log({'phase': 'mic_published'});
      } catch (error) {
        _log({'phase': 'publish_failed', 'error': '$error'});
      }
    }

    // Poll, so the transcript shows how the two states move over time
    // rather than only where they ended up. For a viewer the interesting
    // column is whether the host's camera actually resolved to a track:
    // raven_rtc exposes no getStats, so this is the closest observable to
    // "is media arriving" that the SDK offers on a device.
    for (var i = 1; i <= 12; i++) {
      await Future<void>.delayed(const Duration(seconds: 5));
      final remotes = stream.room.remoteParticipants;
      _attachProbe(stream.room);
      _log({
        'tick': i * 5,
        'probeHasSrcObject': _probe.srcObject != null,
        'probeWidth': _probe.videoWidth,
        'probeHeight': _probe.videoHeight,
        'signaling': stream.room.connectionState.name,
        'media': stream.room.mediaState.name,
        'remotes': remotes.map((p) => p.identity).toList(),
        'remoteCamera': {
          for (final p in remotes)
            p.identity: p.isCameraEnabled,
        },
        'remoteVideoTrack': {
          for (final p in remotes)
            p.identity: p.videoTrackFor(RavenTrackKind.camera) != null,
        },
      });
    }
    _log({'phase': 'done'});
    setState(() => _summary = 'done');
  }

  @override
  Widget build(BuildContext context) {
    final stream = _stream;
    if (stream == null) return Center(child: Text(_summary));
    return ListenableBuilder(
      listenable: stream.room,
      builder: (context, _) => Column(
        children: [
          for (final p in stream.room.participants)
            SizedBox(
              width: 200,
              height: 120,
              child: RavenVideoView(
                key: ValueKey(p.identity),
                participant: p,
                room: stream.room,
              ),
            ),
        ],
      ),
    );
  }
}
