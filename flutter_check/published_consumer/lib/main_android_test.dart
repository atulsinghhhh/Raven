import 'dart:async';
import 'package:flutter/material.dart';
import 'package:raven_rtc/raven_rtc.dart';

/// Android crash-reproduction check (Issue 3). Hardcoded token/room —
/// this is a throwaway diagnostic entrypoint, not a real app, minted
/// fresh per run. Logs every step to logcat via print() so `adb logcat`
/// can be grepped for progress or for the reported jvm.cc/SIGABRT crash.
const _token = String.fromEnvironment('RAVEN_TOKEN');
const _endpoint = String.fromEnvironment('RAVEN_ENDPOINT');
const _roomId = String.fromEnvironment('RAVEN_ROOM_ID');

void main() {
  runApp(const MaterialApp(home: Scaffold(body: Center(child: _Runner()))));
}

class _Runner extends StatefulWidget {
  const _Runner();
  @override
  State<_Runner> createState() => _RunnerState();
}

class _RunnerState extends State<_Runner> {
  String _status = 'booting';

  @override
  void initState() {
    super.initState();
    _run();
  }

  void _log(String s) {
    // ignore: avoid_print
    print('[ANDROID_TEST] $s');
    setState(() => _status = s);
  }

  Future<void> _run() async {
    _log('ANDROID_TEST_START token_len=${_token.length} room=$_roomId');
    try {
      final raven = Raven(token: _token, endpoint: _endpoint);
      _log('ANDROID_TEST_JOINING');
      final room = await raven.join(_roomId);
      _log('ANDROID_TEST_JOINED state=${room.connectionState.name}');

      _log('ANDROID_TEST_ENABLING_MIC');
      await room.enableMicrophone();
      _log('ANDROID_TEST_MIC_OK');

      _log('ANDROID_TEST_ENABLING_CAMERA');
      await room.enableCamera();
      _log('ANDROID_TEST_CAMERA_OK');

      await Future<void>.delayed(const Duration(seconds: 5));

      _log('ANDROID_TEST_LEAVING');
      await room.leave();
      _log('ANDROID_TEST_DONE_SUCCESS');
    } catch (e, st) {
      _log('ANDROID_TEST_FAILED error=$e');
      // ignore: avoid_print
      print('[ANDROID_TEST] stack=$st');
    }
  }

  @override
  Widget build(BuildContext context) => Text(_status);
}
