import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_webrtc/flutter_webrtc.dart' as rtc;

import '../errors.dart';
import 'protocol.dart';
import 'signaling_client.dart';

/// The data-channel label. Must match the SFU's, which closes a channel it
/// does not recognise rather than silently dropping messages on it.
const _dataChannelLabel = 'raven-data';

/// Simulcast ladder for a published camera (spec §15).
///
/// Three spatial layers, each a quarter of the previous one's pixel count
///: the standard ladder, and the one native WebRTC implements well.
const _simulcastEncodings = [
  ('low', 4.0, 150000),
  ('medium', 2.0, 500000),
  ('high', 1.0, 1500000),
];

/// One track this participant is receiving.
class SubscribedTrack {
  SubscribedTrack({
    required this.participantId,
    required this.trackId,
    required this.source,
    required this.track,
    required this.stream,
    required this.muted,
  });

  final String participantId;
  final String trackId;
  final String source;
  final rtc.MediaStreamTrack track;
  final rtc.MediaStream stream;
  bool muted;
}

/// One track this device is publishing.
class PublishedTrack {
  PublishedTrack({
    required this.source,
    required this.track,
    required this.stream,
    required this.sender,
  });

  final String source;
  rtc.MediaStreamTrack track;
  final rtc.MediaStream stream;
  final rtc.RTCRtpSender sender;
  bool muted = false;
}

/// Drives the peer connection against Raven's signaling.
///
/// # Negotiation
///
/// The SFU offers, this answers. That holds even for publishing: a track
/// is added and the SFU's next offer carries it: except on the first
/// publish of a kind, where there is no transceiver yet and a
/// client-initiated offer is unavoidable. The server resolves the
/// resulting glare by refusing the client's offer with a retryable code,
/// and [_negotiatePublish] retries once the server's offer is answered.
///
/// # What this replaced
///
/// `livekit_client` owned all of this. The engine exists because Raven's
/// SFU speaks Raven's protocol, and because that is the whole point of
/// the migration: no client library sits between the app and the media
/// plane, so the media plane can change without an SDK release.
class RavenEngine {
  RavenEngine({
    required this.signaling,
    required this.iceServers,
    required this.adaptiveStream,
  });

  final SignalingClient signaling;
  final List<Map<String, dynamic>> iceServers;

  /// When true, subscriptions follow the size a view is actually showing.
  ///
  /// Implemented by [requestLayer], which [RavenVideoView] calls as it
  /// lays out. On a phone this is the difference between decoding a 1080p
  /// stream into a thumbnail and decoding a thumbnail.
  final bool adaptiveStream;

  rtc.RTCPeerConnection? _pc;
  rtc.RTCDataChannel? _dataChannel;
  StreamSubscription<Map<String, dynamic>>? _messages;

  final _subscribed = <String, SubscribedTrack>{};
  final _published = <String, PublishedTrack>{};
  final _announced = <String, ServerTrack>{};
  final _announcedOwners = <String, String>{};
  final _pendingMedia =
      <String, ({rtc.MediaStreamTrack track, rtc.MediaStream stream})>{};
  final _deferredPublishes = <Future<void> Function()>[];

  final _changes = StreamController<void>.broadcast();
  final _errors = StreamController<RavenException>.broadcast();
  final _data = StreamController<List<int>>.broadcast();

  String? _remoteIceState;
  String? _remotePeerState;
  bool _disposed = false;

  /// Fires whenever the track or participant set changed.
  Stream<void> get changes => _changes.stream;

  /// Failures that arrive asynchronously instead of from a call.
  Stream<RavenException> get errors => _errors.stream;

  /// Payloads another participant sent over the data channel.
  Stream<List<int>> get data => _data.stream;

  Iterable<SubscribedTrack> get subscribedTracks => _subscribed.values;
  Iterable<PublishedTrack> get publishedTracks => _published.values;

  /// The SFU's own view of this connection, which can disagree with the
  /// local one, and that disagreement is often the whole diagnosis.
  ({String? iceState, String? peerState}) get remoteConnectionState =>
      (iceState: _remoteIceState, peerState: _remotePeerState);

  String? get iceConnectionState => _pc?.iceConnectionState?.name;
  String? get signalingState => _pc?.signalingState?.name;

  /// Starts consuming signaling. Call once, after the join completes.
  void start() {
    _messages = signaling.messages.listen((message) {
      unawaited(_handleMessage(message));
    });
  }

  /// Applies the room state reported at join.
  ///
  /// Called on the first join and after every reconnect. On a reconnect
  /// the reported set is authoritative, so tracks nobody is publishing any
  /// more are dropped, not lingering.
  void applyJoinedState(JoinedPayload payload) {
    final present = <String>{};
    for (final participant in payload.participants) {
      for (final track in participant.tracks) {
        final key = _key(participant.id, track.trackId);
        present.add(key);
        _announced[key] = track;
        _announcedOwners[key] = participant.id;
      }
    }

    _announced.removeWhere((key, _) => !present.contains(key));
    _announcedOwners.removeWhere((key, _) => !present.contains(key));
    _subscribed.removeWhere((key, _) => !present.contains(key));
    _notify();
  }

  Future<void> _handleMessage(Map<String, dynamic> message) async {
    if (_disposed) return;

    switch (message['type']) {
      case ServerMessageType.sdpOffer:
        await _handleOffer(message['sdp'] as String? ?? '');
      case ServerMessageType.sdpAnswer:
        await _handleAnswer(message['sdp'] as String? ?? '');
      case ServerMessageType.iceCandidate:
        await _handleRemoteCandidate(IceCandidatePayload.fromJson(message));
      case ServerMessageType.trackPublished:
        _announceTrack(
          message['participantId'] as String? ?? '',
          ServerTrack.fromJson(
              (message['track'] as Map<String, dynamic>?) ?? const {}),
        );
      case ServerMessageType.trackUnpublished:
        _unannounceTrack(
          message['participantId'] as String? ?? '',
          message['trackId'] as String? ?? '',
        );
      case ServerMessageType.trackMuted:
      case ServerMessageType.trackUnmuted:
        _setRemoteMuted(
          message['participantId'] as String? ?? '',
          message['trackId'] as String? ?? '',
          message['type'] == ServerMessageType.trackMuted,
        );
      case ServerMessageType.connectionState:
        _remoteIceState = message['iceState'] as String?;
        _remotePeerState = message['peerState'] as String?;
      case ServerMessageType.error:
        final code = message['code'] as String? ?? '';
        if (code == SignalingErrorCode.negotiationGlare) {
          // Expected: our offer lost a race with the server's. The
          // deferred publish retries once we answer theirs.
          return;
        }
        _errors.add(RavenException(
          RavenErrorCode.signalingError,
          message['message'] as String? ?? 'The RTC server reported an error.',
        ));
    }
  }

  // -------------------------------------------------------------------
  // Peer connection
  // -------------------------------------------------------------------

  Future<rtc.RTCPeerConnection> _ensurePeerConnection() async {
    final existing = _pc;
    if (existing != null) return existing;

    final pc = await rtc.createPeerConnection({
      'iceServers': iceServers,
      // Unified plan is the only spec-compliant semantics and the only
      // one an SFU can negotiate reliably.
      'sdpSemantics': 'unified-plan',
    });

    pc.onIceCandidate = (candidate) {
      if (candidate.candidate == null) {
        // End of gathering. Not forwarded: the server treats the absence
        // of further candidates the same way, and an explicit
        // end-of-candidates message would be one more thing for three
        // client implementations to agree on.
        return;
      }
      signaling.send(IceCandidatePayload(
        candidate: candidate.candidate!,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      ).toJson());
    };

    pc.onTrack = (event) => _handleIncomingTrack(event);

    pc.onDataChannel = (channel) {
      if (channel.label != _dataChannelLabel) return;
      _attachDataChannel(channel);
    };

    _pc = pc;
    return pc;
  }

  Future<void> _handleOffer(String sdp) async {
    final pc = await _ensurePeerConnection();
    try {
      await pc.setRemoteDescription(rtc.RTCSessionDescription(sdp, 'offer'));
      final answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Re-read the local description: the platform may have folded
      // candidates into it, and sending the pre-set copy would drop them.
      final local = await pc.getLocalDescription();
      signaling.send({
        'type': ClientMessageType.sdpAnswer,
        'sdp': local?.sdp ?? answer.sdp ?? '',
      });

      await _flushDeferredPublishes();
    } catch (error) {
      _errors.add(RavenException(
        RavenErrorCode.signalingError,
        "Could not answer the server's offer.",
        error,
      ));
    }
  }

  Future<void> _handleAnswer(String sdp) async {
    final pc = _pc;
    if (pc == null) return;
    try {
      await pc.setRemoteDescription(rtc.RTCSessionDescription(sdp, 'answer'));
    } catch (error) {
      _errors.add(RavenException(
        RavenErrorCode.signalingError,
        'Could not apply the server\'s answer.',
        error,
      ));
    }
  }

  Future<void> _handleRemoteCandidate(IceCandidatePayload payload) async {
    final pc = _pc;
    if (pc == null) return;
    try {
      await pc.addCandidate(rtc.RTCIceCandidate(
        payload.candidate,
        payload.sdpMid,
        payload.sdpMLineIndex,
      ));
    } catch (_) {
      // Candidates commonly arrive just before a remote description is
      // set, or for a transceiver that has since gone. Neither is worth
      // surfacing: the connection succeeds on the ones that do apply.
    }
  }

  Future<void> _flushDeferredPublishes() async {
    final pending = List.of(_deferredPublishes);
    _deferredPublishes.clear();
    for (final retry in pending) {
      await retry();
    }
  }

  /// Offers, so the server learns about a newly added track.
  ///
  /// Needed only when adding a track created a new transceiver: the first
  /// publish of each kind. Later publishes of the same kind reuse it and
  /// ride the server's next offer.
  Future<void> _negotiatePublish() async {
    final pc = _pc;
    if (pc == null) return;

    if (pc.signalingState != rtc.RTCSignalingState.RTCSignalingStateStable) {
      // The server has an offer in flight. Retry after we answer it,
      // rather than creating a competing offer.
      _deferredPublishes.add(_negotiatePublish);
      return;
    }

    try {
      final offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      final local = await pc.getLocalDescription();
      signaling.send({
        'type': ClientMessageType.sdpOffer,
        'sdp': local?.sdp ?? offer.sdp ?? '',
      });
    } catch (error) {
      throw RavenException(
        RavenErrorCode.mediaError,
        'Could not negotiate the published track.',
        error,
      );
    }
  }

  // -------------------------------------------------------------------
  // Incoming media
  // -------------------------------------------------------------------

  /// Matches an arriving track to what signaling said about it.
  ///
  /// `onTrack` and `track.published` race, and either can be first, so
  /// this completes the subscription only when both halves are present,
  /// and parks whichever arrived first. A path that only worked in one
  /// order would drop tracks nondeterministically.
  void _handleIncomingTrack(rtc.RTCTrackEvent event) {
    final track = event.track;
    final stream = event.streams.isNotEmpty ? event.streams.first : null;
    if (stream == null) return;

    final owner = _ownerOfAnnouncedTrack(track.id ?? '');
    if (owner == null) {
      _pendingMedia[track.id ?? ''] = (track: track, stream: stream);
      return;
    }

    _completeSubscription(owner.participantId, owner.track, track, stream);
  }

  ({String participantId, ServerTrack track})? _ownerOfAnnouncedTrack(
      String trackId) {
    for (final entry in _announced.entries) {
      if (entry.value.trackId == trackId) {
        final participantId = _announcedOwners[entry.key];
        if (participantId != null) {
          return (participantId: participantId, track: entry.value);
        }
      }
    }
    return null;
  }

  void _announceTrack(String participantId, ServerTrack track) {
    if (track.trackId.isEmpty) return;

    final key = _key(participantId, track.trackId);
    _announced[key] = track;
    _announcedOwners[key] = participantId;

    final pending = _pendingMedia.remove(track.trackId);
    if (pending != null) {
      _completeSubscription(
          participantId, track, pending.track, pending.stream);
      return;
    }
    _notify();
  }

  void _unannounceTrack(String participantId, String trackId) {
    final key = _key(participantId, trackId);
    _announced.remove(key);
    _announcedOwners.remove(key);
    _pendingMedia.remove(trackId);
    _subscribed.remove(key);
    _notify();
  }

  void _completeSubscription(
    String participantId,
    ServerTrack serverTrack,
    rtc.MediaStreamTrack track,
    rtc.MediaStream stream,
  ) {
    final key = _key(participantId, serverTrack.trackId);
    if (_subscribed.containsKey(key)) return;

    _subscribed[key] = SubscribedTrack(
      participantId: participantId,
      trackId: serverTrack.trackId,
      source: serverTrack.source,
      track: track,
      stream: stream,
      muted: serverTrack.muted,
    );
    _notify();
  }

  void _setRemoteMuted(String participantId, String trackId, bool muted) {
    final subscription = _subscribed[_key(participantId, trackId)];
    if (subscription == null) return;
    // The publisher's mute, reported by the SFU: not the platform's
    // "no data arriving" flag, which flickers during ordinary jitter and
    // would flash a muted badge on a healthy connection.
    subscription.muted = muted;
    _notify();
  }

  /// Asks the SFU for a different simulcast layer of a subscribed track.
  ///
  /// A preference, not a command: the SFU will not hand over a layer the
  /// publisher is not sending, and congestion control may hold it lower.
  /// A UI that treated this as a command would show the wrong quality.
  void requestLayer(String participantId, String trackId, String layer) {
    if (!adaptiveStream) return;
    signaling.send({
      'type': ClientMessageType.subscriptionUpdate,
      'publisherId': participantId,
      'trackId': trackId,
      'layer': layer,
    });
  }

  // -------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------

  /// Publishes a locally captured track under a declared source.
  Future<PublishedTrack> publish({
    required String source,
    required rtc.MediaStream stream,
    required rtc.MediaStreamTrack track,
  }) async {
    final pc = await _ensurePeerConnection();

    final rtc.RTCRtpSender sender;
    try {
      sender = await pc.addTrack(track, stream);
    } catch (error) {
      throw RavenException(
        RavenErrorCode.mediaError,
        'Could not add the $source track to the connection.',
        error,
      );
    }

    // Declared over signaling, not inferred from the SDP: an application
    // cannot choose the stream or track id that reaches the wire, so
    // codec kind is all the SFU could otherwise go on, and that cannot
    // tell a screen share from a camera (spec §16). Sent before
    // negotiating so the source is known by the time the media arrives.
    signaling.send({
      'type': ClientMessageType.trackPublish,
      'trackId': track.id ?? '',
      'source': source,
    });

    if (source == 'camera') {
      await _applySimulcast(sender);
    }

    final published = PublishedTrack(
      source: source,
      track: track,
      stream: stream,
      sender: sender,
    );
    _published[source] = published;

    await _negotiatePublish();
    _notify();
    return published;
  }

  Future<void> unpublish(String source) async {
    final published = _published.remove(source);
    if (published == null) return;

    try {
      await _pc?.removeTrack(published.sender);
    } catch (_) {
      // Already gone, usually because the connection is closing.
    }
    await published.track.stop();
    await published.stream.dispose();

    await _negotiatePublish();
    _notify();
  }

  PublishedTrack? publishedTrack(String source) => _published[source];

  /// Mutes a published track without unpublishing it.
  ///
  /// `enabled = false` makes the platform send silence or black frames:
  /// the stream continues, the transceiver stays, and unmuting is
  /// instant. Stopping the track instead would release the device and
  /// then need a fresh capture and a renegotiation to undo.
  Future<void> setMuted(String source, bool muted) async {
    final published = _published[source];
    if (published == null) return;

    published.track.enabled = !muted;
    published.muted = muted;

    // The SFU is told separately so it can stop forwarding the silence to
    // every subscriber instead of paying to relay it.
    signaling.send({
      'type': ClientMessageType.trackMute,
      'trackId': published.track.id ?? '',
      'muted': muted,
    });
    _notify();
  }

  /// Swaps the device behind a published track without renegotiating.
  ///
  /// `replaceTrack` leaves the transceiver, the SSRC and every
  /// subscriber's view untouched, so nobody else in the room sees
  /// anything happen.
  Future<void> replaceTrack(String source, rtc.MediaStreamTrack next) async {
    final published = _published[source];
    if (published == null) return;

    await published.sender.replaceTrack(next);
    final previous = published.track;
    published.track = next;
    if (published.muted) {
      next.enabled = false;
    }
    await previous.stop();
    _notify();
  }

  Future<void> _applySimulcast(rtc.RTCRtpSender sender) async {
    try {
      final parameters = sender.parameters;
      // Some platforms report no encodings until the first negotiation
      // completes. Setting them then fails; the SFU falls back to a single
      // layer, which is correct, not broken.
      if (parameters.encodings == null || parameters.encodings!.isEmpty) {
        return;
      }

      parameters.encodings = _simulcastEncodings
          .map((encoding) => rtc.RTCRtpEncoding(
                rid: encoding.$1,
                scaleResolutionDownBy: encoding.$2,
                maxBitrate: encoding.$3,
              ))
          .toList(growable: false);
      await sender.setParameters(parameters);
    } catch (_) {
      // Not fatal. A publisher without simulcast still publishes; every
      // subscriber just receives the one layer.
    }
  }

  // -------------------------------------------------------------------
  // Data channel
  // -------------------------------------------------------------------

  void _attachDataChannel(rtc.RTCDataChannel channel) {
    _dataChannel = channel;
    channel.onMessage = (message) {
      // No participant is attributed: the SFU fans data out on each
      // recipient's own channel, so the transport carries no sender
      // identity. Attributing it would mean trusting a field the sender
      // controls, which is worse than saying nothing.
      _data.add(message.binary);
    };
  }

  /// Sends a payload to everyone else in the room.
  Future<void> sendData(List<int> payload) async {
    final pc = _pc;
    if (pc == null) {
      throw const RavenException(
        RavenErrorCode.connectionFailed,
        'sendData() requires an active connection.',
      );
    }

    var channel = _dataChannel;
    if (channel == null) {
      // Opened on demand: a channel costs an SCTP association, and most
      // calls never send data.
      channel = await pc.createDataChannel(
        _dataChannelLabel,
        rtc.RTCDataChannelInit()..ordered = true,
      );
      _attachDataChannel(channel);
    }

    await channel.send(rtc.RTCDataChannelMessage.fromBinary(
      Uint8List.fromList(payload),
    ));
  }

  // -------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------

  /// Tears the peer connection down, keeping signaling alive.
  ///
  /// Used on reconnect: the server allocates a fresh session on rejoin, so
  /// the old connection is not reusable, and leaving it open would let a
  /// caller see a connection that looks alive but forwards nothing.
  Future<void> resetPeerConnection() async {
    final pc = _pc;
    _pc = null;
    _dataChannel = null;
    _subscribed.clear();
    _pendingMedia.clear();
    _deferredPublishes.clear();

    if (pc != null) {
      // Handlers cleared before closing, so a state change fired during
      // teardown is not mistaken for a connection failure.
      pc.onIceCandidate = null;
      pc.onTrack = null;
      pc.onDataChannel = null;
      await pc.close();
    }
    _notify();
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;

    await _messages?.cancel();

    for (final published in _published.values) {
      await published.track.stop();
      await published.stream.dispose();
    }
    _published.clear();

    await resetPeerConnection();
    await _changes.close();
    await _errors.close();
    await _data.close();
  }

  void _notify() {
    if (_disposed || _changes.isClosed) return;
    _changes.add(null);
  }

  static String _key(String participantId, String trackId) =>
      '$participantId/$trackId';
}
