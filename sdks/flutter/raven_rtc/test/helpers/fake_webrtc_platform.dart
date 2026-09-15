import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
// ignore: implementation_imports
import 'package:flutter_webrtc/src/native/media_stream_impl.dart';
// ignore: implementation_imports
import 'package:flutter_webrtc/src/native/media_stream_track_impl.dart';

/// Fakes flutter_webrtc's native platform channel well enough for
/// [RavenEngine] to run its real SDP-negotiation and data-channel logic
/// against a scripted peer, instead of a live WebRTC stack.
///
/// This does not simulate ICE, DTLS or real media. It exists to prove the
/// SDK's own message-handling, negotiation-queue and data-channel logic
/// runs correctly end to end — the bugs this suite regression-tests were
/// all in that logic, not in flutter_webrtc or the native platform — not
/// to stand in for the live E2E media tests the fix ultimately needs
/// against a real SFU and real devices.
///
/// Modelled on flutter_webrtc's own
/// `test/unit/rtc_peerconnection_test.dart`: a peer connection's
/// `signalingState` and a data channel's `state` are only ever updated by
/// an event arriving on their respective `EventChannel`s
/// (`FlutterWebRTC/peerConnectionEvent<id>` and
/// `FlutterWebRTC/dataChannelEvent<peerConnectionId><flutterId>`), so a
/// test that needs a particular state has to deliver that event itself —
/// see [signalingState] and [openDataChannel].
class FakeWebRtcPlatform {
  FakeWebRtcPlatform() {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, _handle);
  }

  static const _channel = MethodChannel('FlutterWebRTC.Method');
  static const _codec = StandardMethodCodec();

  int _pcCounter = 0;
  int _dcCounter = 0;
  int _senderCounter = 0;

  final _localSdp = <String, String>{};
  final _localType = <String, String>{};

  /// The state `getSignalingState()` (the *live*, non-cached read) reports
  /// for each peer connection — driven by the actual `setLocalDescription`
  /// / `setRemoteDescription` calls received, exactly like a real
  /// RTCPeerConnection's signaling-state machine, not by an explicit event
  /// a test fires. [RavenEngine] reads this one to decide whether to
  /// negotiate or defer (see engine.dart's `_negotiatePublish` and
  /// `_handleOffer`) specifically because the *cached* `signalingState`
  /// getter (below, driven by [signalingState]) lags a real event's
  /// arrival on Flutter Web, which is the race the glare-recovery tests
  /// exist to catch.
  final _liveSignalingStates = <String, String>{};

  /// Every method invoked, in order — for asserting what the engine did
  /// (and did not do) without depending on its private fields.
  final calls = <String>[];

  /// The `type` of every `setLocalDescription` call, in order — `offer`,
  /// `answer`, or `rollback`. `calls` alone can't distinguish these, and
  /// the glare-recovery tests need to prove a rollback specifically
  /// happened, not merely that *some* local description was set.
  final localDescriptionTypes = <String>[];

  /// The peer connection id `createPeerConnection` most recently minted.
  String? lastPeerConnectionId;

  /// Detaches the mock handler. Call from `tearDown`.
  void dispose() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
  }

  Future<dynamic> _handle(MethodCall call) async {
    calls.add(call.method);
    final args = (call.arguments as Map?)?.cast<String, dynamic>() ?? const {};
    final peerConnectionId = args['peerConnectionId'] as String?;

    switch (call.method) {
      case 'createPeerConnection':
        // A real platform call crosses a genuine async boundary (native
        // code, or in a real browser a JS interop round trip), wide
        // enough for two callers racing to create one to both find
        // nothing there yet. A same-isolate mock otherwise resolves this
        // in roughly the same microtask it was called from, which closes
        // that window and would make the race this helper exists to
        // reproduce (see engine_test.dart's "concurrent callers" group)
        // impossible to hit deterministically.
        await Future<void>.delayed(Duration.zero);
        _pcCounter++;
        final id = 'pc-$_pcCounter';
        lastPeerConnectionId = id;
        _liveSignalingStates[id] = 'stable';
        return {'peerConnectionId': id, 'sessionId': 'session-$_pcCounter'};

      case 'setLocalDescription':
        final description =
            (args['description'] as Map).cast<String, dynamic>();
        final type = description['type'] as String;
        localDescriptionTypes.add(type);
        _liveSignalingStates[peerConnectionId!] = switch (type) {
          'offer' => 'have-local-offer',
          'pranswer' => 'have-local-pranswer',
          'answer' || 'rollback' => 'stable',
          _ => _liveSignalingStates[peerConnectionId] ?? 'stable',
        };
        if (type == 'rollback') {
          // A real rollback discards the pending local offer rather than
          // replacing it with new SDP; nothing meaningful to store.
          return null;
        }
        _localSdp[peerConnectionId] = description['sdp'] as String;
        _localType[peerConnectionId] = type;
        return null;

      case 'getLocalDescription':
        final sdp = _localSdp[peerConnectionId];
        if (sdp == null) return null;
        return {'sdp': sdp, 'type': _localType[peerConnectionId]};

      case 'createOffer':
        return {
          'sdp': 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\n',
          'type': 'offer'
        };

      case 'createAnswer':
        return {
          'sdp': 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\n',
          'type': 'answer',
        };

      case 'addTrack':
        _senderCounter++;
        return {
          'senderId': 'sender-$_senderCounter',
          'ownsTrack': true,
          'dtmfSenderId': 'dtmf-$_senderCounter',
          'track': {
            'id': args['trackId'],
            'label': 'fake',
            'kind': 'video',
            'enabled': true,
          },
          'rtpParameters': {
            'transactionId': 't-$_senderCounter',
            'encodings': const [],
            'headerExtensions': const [],
            'codecs': const [],
            'rtcp': const {'cname': '', 'reducedSize': false},
          },
        };

      case 'createDataChannel':
        _dcCounter++;
        return {'id': _dcCounter, 'flutterId': 'dc-$_dcCounter'};

      case 'getSignalingState':
        return {'state': _liveSignalingStates[peerConnectionId] ?? 'stable'};

      case 'setRemoteDescription':
        final description =
            (args['description'] as Map).cast<String, dynamic>();
        final type = description['type'] as String;
        _liveSignalingStates[peerConnectionId!] = switch (type) {
          'offer' => 'have-remote-offer',
          'pranswer' => 'have-remote-pranswer',
          'answer' => 'stable',
          _ => _liveSignalingStates[peerConnectionId] ?? 'stable',
        };
        return null;

      case 'setConfiguration':
      case 'addStream':
      case 'removeStream':
      case 'addCandidate':
      case 'peerConnectionDispose':
      case 'peerConnectionClose':
      case 'dataChannelSend':
      case 'dataChannelClose':
      case 'dataChannelDispose':
        return null;

      default:
        return null;
    }
  }

  /// Delivers a `signalingState` event for [peerConnectionId], as the
  /// native side would after every `setLocalDescription` /
  /// `setRemoteDescription`. `RavenEngine._negotiatePublish` reads
  /// `RTCPeerConnection.signalingState`, which flutter_webrtc only ever
  /// updates from an event like this one — never from the method-channel
  /// response of the call that changed it.
  Future<void> signalingState(String peerConnectionId, String state) {
    // Also drives the live-read path ([_liveSignalingStates]), so a test
    // that forces a state this way (rather than through an actual
    // setLocalDescription/setRemoteDescription call) is visible to
    // getSignalingState() too, not only the cached property.
    _liveSignalingStates[peerConnectionId] = state;
    return _sendEvent(
      'FlutterWebRTC/peerConnectionEvent$peerConnectionId',
      {'event': 'signalingState', 'state': state},
    );
  }

  /// Delivers a `dataChannelStateChanged: open` event for the most
  /// recently created data channel, as the native side would once the
  /// SCTP association finishes coming up.
  Future<void> openDataChannel(String peerConnectionId) {
    return _sendEvent(
      'FlutterWebRTC/dataChannelEvent$peerConnectionId'
      'dc-$_dcCounter',
      {
        'event': 'dataChannelStateChanged',
        'id': _dcCounter,
        'flutterId': 'dc-$_dcCounter',
        'state': 'open',
      },
    );
  }

  Future<void> _sendEvent(String channel, Map<String, dynamic> event) async {
    final data = _codec.encodeSuccessEnvelope(event);
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(channel, data, (ByteData? _) {});
  }
}

/// A local track that needs no camera, no microphone and no platform
/// call — just enough for [RavenEngine.publish] to have something to
/// hand `RTCPeerConnection.addTrack`.
({MediaStreamNative stream, MediaStreamTrackNative track}) fakeLocalMedia(
  String peerConnectionId, {
  String trackId = 'local-track-1',
  String kind = 'video',
}) {
  final stream = MediaStreamNative('stream-$trackId', 'local');
  final track =
      MediaStreamTrackNative(trackId, 'fake', kind, true, peerConnectionId);
  return (stream: stream, track: track);
}
