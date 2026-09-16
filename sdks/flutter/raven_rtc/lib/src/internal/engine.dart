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

/// Drives the peer connection against Livqeno's signaling.
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
/// `livekit_client` owned all of this. The engine exists because Livqeno's
/// SFU speaks Livqeno's protocol, and because that is the whole point of
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
  StreamSubscription<SignalingLifecycle>? _lifecycle;

  final _subscribed = <String, SubscribedTrack>{};
  final _published = <String, PublishedTrack>{};
  final _announced = <String, ServerTrack>{};
  final _announcedOwners = <String, String>{};
  final _pendingMedia =
      <String, ({rtc.MediaStreamTrack track, rtc.MediaStream stream})>{};
  final _deferredPublishes = <Future<void> Function()>[];

  /// Completes once the SFU's first offer for the *current* peer connection
  /// generation has been answered (see [_handleOffer]).
  ///
  /// [publish] awaits this before ever calling [_negotiatePublish]. Without
  /// it, `enableCamera()`/`enableMicrophone()` called right after joining
  /// can call [_ensurePeerConnection] and offer before the SFU's own
  /// join-time offer has even been read off the socket — a race
  /// `pc.getSignalingState()` cannot see, because a peer connection that
  /// has not touched a description at all is `stable` too. This closes
  /// that half of the race deterministically: no timer, no polling, just
  /// awaiting the one event that has to happen anyway.
  ///
  /// Recreated in [_createPeerConnection] for every new generation ([
  /// _pcGeneration]), so a reconnect's fresh peer connection gets its own
  /// barrier instead of resolving instantly off the previous connection's.
  Completer<void> _initialOfferHandled = Completer<void>();

  /// Whether this negotiation round has already used its one immediate,
  /// no-inbound-message-required retry after a [SignalingErrorCode.
  /// negotiationGlare] response — see the `ServerMessageType.error` case in
  /// [_handleMessage].
  ///
  /// Bounded to one attempt per round on purpose. The SFU's glare
  /// rejection is a plain refusal, not a state change — retrying while its
  /// `offerInFlight` guard is still set (see services/sfu's
  /// `Participant.beginNegotiation`) glares again, and retrying *that*
  /// immediately too would reproduce the exact failure packages/sdk's own
  /// history warns about: an unbounded offer/rollback storm that trips the
  /// connection's message rate limit. One immediate attempt costs at most
  /// one extra round trip and resolves the common case (the SFU's answer
  /// processing was merely a little behind); if the round is genuinely
  /// stuck, this falls back to the existing, already-tested recovery via
  /// [_handleOffer]/[_handleAnswer] — or, failing that, the SFU's own
  /// retry once it abandons its stale offer.
  ///
  /// Reset at the start of [_handleOffer] and [_handleAnswer]: a real
  /// round trip completing is what earns the next glare a fresh attempt.
  bool _glareRecoveryAttempted = false;

  /// Serializes every operation that can change [_pc]'s `signalingState` —
  /// our own offers, the SFU's offers, its answers to ours — so an async
  /// gap inside one can never let another run against a signalingState it
  /// didn't expect to find.
  ///
  /// `signaling.messages.listen` in [start] dispatches each message via
  /// `unawaited(_handleMessage(...))`, so without this, an offer and an
  /// answer (or two offers) arriving back to back could interleave here.
  /// packages/sdk avoids the equivalent race by coalescing everything
  /// behind the browser's `onnegotiationneeded` event; flutter_webrtc's
  /// native platform channel exposes no such event (only its web backend
  /// does — see dart_webrtc's `onRenegotiationNeeded`), so this package
  /// cannot rely on it without behaving differently per platform. A plain
  /// FIFO chain gets the same guarantee everywhere `RavenEngine` runs.
  ///
  /// Only entry points reached from *outside* an already-serialized task
  /// go through this ([_handleMessage]'s offer/answer/glare-error cases,
  /// and [publish]/[unpublish]). [_flushDeferredPublishes] calls
  /// [_negotiatePublish] directly, never wrapped again: it only ever runs
  /// from inside [_handleOffer], [_handleAnswer], or [_recoverFromGlare],
  /// which are themselves already the chain's current task, and
  /// re-wrapping there would queue behind a task waiting on that very
  /// call — a deadlock.
  Future<void> _negotiationChain = Future<void>.value();

  Future<T> _serialized<T>(Future<T> Function() operation) {
    final result = _negotiationChain.then((_) => operation());
    // Chained regardless of outcome: a failed round must not wedge every
    // negotiation after it, and the caller still observes the failure
    // through the Future `result` itself.
    _negotiationChain = result.then((_) {}, onError: (_) {});
    return result;
  }

  final _changes = StreamController<void>.broadcast();
  final _errors = StreamController<RavenException>.broadcast();
  final _data = StreamController<List<int>>.broadcast();

  /// Callers of [sendData] and [ensureDataChannel] waiting for the data
  /// channel to open. Settled together, in [_attachDataChannel], once it
  /// does; failed together on a terminal signaling failure ([_abortDataChannelWaiters]).
  final _dataChannelWaiters = <Completer<void>>[];

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

  /// Starts consuming signaling.
  ///
  /// Called from [RavenRoom.attach], before [signaling] is asked to
  /// connect — not after the join completes. Subscribing only once
  /// already joined is what used to drop the SFU's `sdp.offer`: it and
  /// `room.joined` race the instant the join resolves, and a broadcast
  /// stream with no listener yet simply loses whatever is added to it.
  void start() {
    _messages = signaling.messages.listen((message) {
      unawaited(_handleMessage(message));
    });
    _lifecycle = signaling.lifecycle.listen((state) {
      switch (state) {
        case SignalingFailed(:final error):
          _abortDataChannelWaiters(error);
        case SignalingClosed():
          _abortDataChannelWaiters(const RavenException(
            RavenErrorCode.connectionFailed,
            'The connection closed before the data channel could open.',
          ));
        case SignalingReconnecting():
          // Not aborted: rejoining recreates the channel and settles the
          // wait normally. See _abortDataChannelWaiters.
          break;
      }
    });
  }

  /// Applies the room state reported at join.
  ///
  /// Called on the first join and after every reconnect. On a reconnect
  /// the reported set is authoritative, so tracks nobody is publishing any
  /// more are dropped, not lingering.
  ///
  /// A late joiner's own `onTrack` for an already-live publisher's media
  /// can fire before this runs — `room.joined` and the SFU's join-time
  /// offer arrive close together, and nothing orders "the roster's own
  /// announcements landed" ahead of "the peer connection's tracks
  /// arrived" the way [_announceTrack] is ordered relative to a *later*
  /// publish. Without draining [_pendingMedia] here the way
  /// [_announceTrack] already does, a track parked before this call ran
  /// never gets a second chance: nothing else was ever going to announce
  /// it again, so it sits there forever and that participant's media
  /// never completes subscribing.
  void applyJoinedState(JoinedPayload payload) {
    final present = <String>{};
    for (final participant in payload.participants) {
      for (final track in participant.tracks) {
        final key = _key(participant.id, track.trackId);
        present.add(key);
        _announced[key] = track;
        _announcedOwners[key] = participant.id;

        final pending = _pendingMedia.remove(track.trackId);
        if (pending != null) {
          _completeSubscription(
              participant.id, track, pending.track, pending.stream);
        }
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
        await _serialized(() => _handleOffer(message['sdp'] as String? ?? ''));
      case ServerMessageType.sdpAnswer:
        await _serialized(() => _handleAnswer(message['sdp'] as String? ?? ''));
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
          // Genuine glare: the SFU refused our offer because its own is
          // already on the way (services/sfu's AcceptOffer — "our offer
          // stands, the client retries once it has answered it"). The
          // refused offer described real local state (a track just
          // published, most often), so it must not simply be dropped, or
          // that track sits on the peer connection forever undeclared to
          // the server: exactly what left publishers showing camera/mic
          // as unpublished despite a successful-looking `publish()` call.
          //
          // Requeued through the same path a publish takes when it finds
          // the peer connection already mid-round, so it is still covered
          // if [_handleOffer]/[_handleAnswer] is what ends up flushing it
          // — the SFU's own offer, the one this glare made way for, is the
          // normal, expected way this resolves.
          _deferredPublishes.add(_negotiatePublish);
          // But that offer is not guaranteed to arrive promptly: a live
          // trace showed the SFU's *own* AcceptAnswer for our join-time
          // answer stall for the full 15s answerTimeout before it retried
          // on its own, during which nothing else was ever going to flush
          // this queue. One immediate, bounded retry — see
          // [_glareRecoveryAttempted] for why it is bounded — gives this
          // round a free chance to resolve in well under that, without
          // waiting on any inbound message at all.
          await _serialized(_recoverFromGlare);
          return;
        }
        _errors.add(RavenException(
          RavenErrorCode.signalingError,
          message['message'] as String? ?? 'The RTC server reported an error.',
        ));
    }
  }

  /// Rolls our glare-refused offer back and, once only, retries whatever
  /// is deferred behind it right away — see [_glareRecoveryAttempted].
  ///
  /// Safe to call whether or not our own offer is actually still
  /// outstanding: [_handleOffer] may already have rolled it back if the
  /// SFU's offer won the race to arrive first, in which case this is a
  /// no-op past the state check and [_flushDeferredPublishes] finds
  /// nothing left to do.
  Future<void> _recoverFromGlare() async {
    if (_glareRecoveryAttempted) {
      // Already spent this round's one attempt; wait for a real round
      // trip ([_handleOffer]/[_handleAnswer]) to earn another, exactly as
      // before this method existed.
      return;
    }
    _glareRecoveryAttempted = true;

    final pc = _pc;
    if (pc == null) return;
    try {
      // Live read, same reasoning as [_handleOffer]'s: the platform's
      // cached signalingState getter can lag the setLocalDescription(offer)
      // call that just glared.
      final state = await pc.getSignalingState();
      if (state == rtc.RTCSignalingState.RTCSignalingStateHaveLocalOffer) {
        try {
          // Same wire form as _handleOffer's rollback — flutter_webrtc has
          // no dedicated rollback call.
          await pc
              .setLocalDescription(rtc.RTCSessionDescription('', 'rollback'));
        } catch (error) {
          // Best-effort, same as _handleOffer: the retry offer below
          // performs an implicit rollback on platforms where an explicit
          // one fails.
        }
      }
    } catch (error) {
      // A failed live-state read leaves the offer in whatever state it
      // was in; _flushDeferredPublishes below still gets a chance to run,
      // and _negotiatePublish's own state check protects it either way.
    }

    await _flushDeferredPublishes();
  }

  // -------------------------------------------------------------------
  // Peer connection
  // -------------------------------------------------------------------

  /// The in-flight creation, while one is running; cleared once it
  /// settles, successfully or not, so the next caller that finds [_pc]
  /// still null starts a fresh attempt instead of joining a dead one.
  ///
  /// Without this, [_ensurePeerConnection] is a classic check-then-await
  /// race: two callers can both read [_pc] as null before either's
  /// `createPeerConnection()` resolves, and both proceed to create one.
  /// Whichever finishes last silently wins `_pc = pc`; the other's
  /// connection is now orphaned, but its caller still holds a reference
  /// to it and keeps negotiating on it as if it were live. The SFU only
  /// expects one session per participant, so from its side this looks
  /// like a confused peer sending two overlapping SDP/ICE exchanges for
  /// the same participant, and whichever one it ends up tracking is not
  /// guaranteed to be the one this engine kept as [_pc] — `onTrack`
  /// on the connection that lost gets attached, but frequently never
  /// fires, since the SFU never completed a real ICE/DTLS session with
  /// it. This is exactly the shape of race a participant hits by
  /// joining an already-live room and publishing right away: the SFU's
  /// join-time offer (needing a peer connection to answer on) and this
  /// device's own `publish()` (needing one to add a track to) both reach
  /// [_ensurePeerConnection] within the same span of microtasks.
  Future<rtc.RTCPeerConnection>? _pcCreating;

  /// Bumped by [resetPeerConnection] so a creation already in flight at
  /// reset time can tell it's stale once it finishes, instead of
  /// resurrecting [_pc] with a connection the reset already discarded.
  /// [_pcCreating] alone isn't enough for that: nulling it out mid-flight
  /// stops *new* callers from joining the stale attempt, but the
  /// attempt itself is still running and would otherwise still assign
  /// `_pc = pc` on completion.
  int _pcGeneration = 0;

  Future<rtc.RTCPeerConnection> _ensurePeerConnection() {
    final existing = _pc;
    if (existing != null) return Future.value(existing);
    return _pcCreating ??= _createPeerConnection(_pcGeneration);
  }

  Future<rtc.RTCPeerConnection> _createPeerConnection(int generation) async {
    final pc = await rtc.createPeerConnection({
      'iceServers': iceServers,
      // Unified plan is the only spec-compliant semantics and the only
      // one an SFU can negotiate reliably.
      'sdpSemantics': 'unified-plan',
    });

    if (generation != _pcGeneration) {
      // A reset landed while this was in flight. Close it rather than
      // leaving it to leak: nothing will ever reference it as [_pc], so
      // it would otherwise sit there holding a camera/mic and gathering
      // ICE candidates for a session nobody is using.
      unawaited(pc.close());
      throw StateError('peer connection reset while it was being created');
    }

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

    pc.onTrack = (event) => unawaited(_handleIncomingTrack(event));

    pc.onDataChannel = (channel) {
      if (channel.label != _dataChannelLabel) return;
      _attachDataChannel(channel);
    };

    _pc = pc;
    _pcCreating = null;
    return pc;
  }

  Future<void> _handleOffer(String sdp) async {
    // A real round trip is starting: whatever glare a previous offer hit
    // has, at minimum, been superseded by this one. See
    // [_glareRecoveryAttempted]'s doc comment for why this is where its
    // one-shot budget refills.
    _glareRecoveryAttempted = false;
    final pc = await _ensurePeerConnection();
    try {
      // Live read — see _negotiatePublish's doc comment on why the cached
      // `pc.signalingState` getter is not trustworthy here either: an
      // offer we just sent may not have updated it yet.
      final state = await pc.getSignalingState();
      if (state == rtc.RTCSignalingState.RTCSignalingStateHaveLocalOffer) {
        // Real glare: this offer arrived while our own was still
        // outstanding. The SFU is the impolite peer by design (see
        // services/sfu's Participant.AcceptOffer) — it has already
        // refused, or is about to refuse, our offer with
        // NEGOTIATION_GLARE (see the ServerMessageType.error case above),
        // so rolling back here just brings the local description in line
        // with what the server already decided, instead of
        // setRemoteDescription below throwing "Called in wrong state".
        try {
          // flutter_webrtc has no dedicated rollback call. An empty-SDP
          // description typed 'rollback' is the spec-correct wire form
          // for one; dart_webrtc's setLocalDescription force-unwraps
          // description.sdp (rtc_peerconnection_impl.dart), so this has
          // to be '' rather than null, or the unwrap throws before the
          // platform ever sees the call.
          await pc
              .setLocalDescription(rtc.RTCSessionDescription('', 'rollback'));
        } catch (error) {
          // Best-effort: setRemoteDescription(offer) below performs an
          // implicit rollback per the WebRTC spec on platforms where an
          // explicit one fails or isn't implemented, so proceed either
          // way.
        }
      }

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

      // The SFU's first offer for this generation has now been answered —
      // whatever was waiting on [_initialOfferHandled] (a publish() that
      // arrived before this offer did) is free to negotiate. Idempotent:
      // every offer after the first finds this already completed.
      if (!_initialOfferHandled.isCompleted) {
        _initialOfferHandled.complete();
      }

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
    // See _handleOffer's matching reset — an answer to our own offer is
    // just as much a completed round trip as the SFU offering first.
    _glareRecoveryAttempted = false;
    try {
      await pc.setRemoteDescription(rtc.RTCSessionDescription(sdp, 'answer'));

      // The round this answer just completed may have had another
      // publish queued behind it (_negotiatePublish's `signalingState !=
      // stable` branch, reached when a second track was published while
      // our first offer was still outstanding). Without this, that
      // publish stayed queued until something unrelated prompted the SFU
      // to offer again — previously only _handleOffer flushed the queue,
      // so a publish that only ever raced our own offer, never the
      // SFU's, retried on nothing.
      await _flushDeferredPublishes();
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

    // A *live* read, not the cached `pc.signalingState` getter: that
    // cache only updates from a `signalingState` platform event, which on
    // Flutter Web arrives via the browser's own `signalingstatechange`
    // listener — asynchronously, on its own turn of the event loop. Called
    // right after _handleOffer's own setRemoteDescription/setLocalDescription
    // (as _flushDeferredPublishes does), that event can easily not have
    // landed yet, so the cache still reads the description-old state and
    // this defers a retry that was actually free to send — forever, since
    // nothing else was going to prompt another flush. getSignalingState()
    // asks the platform directly and has no such lag.
    final state = await pc.getSignalingState();
    if (state != rtc.RTCSignalingState.RTCSignalingStateStable) {
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
  ///
  /// The id used to do that matching is [_remoteTrackIdFor]'s, never
  /// [rtc.MediaStreamTrack.id] directly — see that method's doc for why
  /// trusting the platform's own id here silently drops every
  /// subscription.
  Future<void> _handleIncomingTrack(rtc.RTCTrackEvent event) async {
    final track = event.track;
    final stream = event.streams.isNotEmpty ? event.streams.first : null;
    if (stream == null) return;

    final resolvedId = await _remoteTrackIdFor(event) ?? track.id ?? '';
    final owner = _ownerOfAnnouncedTrack(resolvedId);
    if (owner == null) {
      _pendingMedia[resolvedId] = (track: track, stream: stream);
      return;
    }

    _completeSubscription(owner.participantId, owner.track, track, stream);
  }

  /// The id the SFU actually published this track under, read from the
  /// remote SDP's `a=msid:` line — never [rtc.MediaStreamTrack.id].
  ///
  /// `RTCTrackEvent.track.id` is **not** the remote track id: the
  /// platform mints a fresh local id for a track it just received and
  /// ignores the `msid` the sender put on the wire, which is what the SFU
  /// actually announces in `track.published`. Matching on the local id
  /// therefore never matches anything — every subscription silently
  /// parks in [_pendingMedia] forever, with no error, because from this
  /// engine's point of view the announcement simply "hasn't arrived yet".
  /// `packages/sdk`'s adapter hit the identical bug against Chrome and
  /// documents the same fix: read the id the remote peer actually picked
  /// out of the SDP, located by the transceiver's `mid` rather than by
  /// scanning for the first `a=msid:` line, since a participant
  /// publishing both a camera and a screen share has two video
  /// m-sections and the wrong one mislabels both.
  ///
  /// Returns null when the mid or the msid can't be read yet — an
  /// `msid`-less section, or a transceiver whose `mid` hasn't settled —
  /// so the caller can fall back to the local id rather than guessing.
  Future<String?> _remoteTrackIdFor(rtc.RTCTrackEvent event) async {
    final mid = event.transceiver?.mid;
    if (mid == null || mid.isEmpty) return null;
    final remote = await _pc?.getRemoteDescription();
    final sdp = remote?.sdp;
    if (sdp == null) return null;
    return _msidTrackIdForMid(sdp, mid);
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
    // The local MediaStream is already capturing and ready to render right
    // here — notify now rather than waiting for the SFU round trip below,
    // so a local self-preview shows up as soon as the camera/mic actually
    // opens instead of appearing to hang until negotiation finishes (external
    // report: local tile stuck on its placeholder while the remote tile,
    // which has no equivalent avoidable delay, rendered immediately).
    _notify();

    // Everything above is local (or, for track.publish, fire-and-forget
    // and order-independent of the offer/answer round) and safe to do the
    // instant the app calls publish() — including before the SFU's own
    // join-time offer has even arrived. Only the actual offer has to
    // wait: see [_initialOfferHandled]'s doc comment for the race this
    // closes. A no-op await once the first round has completed, which is
    // true for every publish after the first.
    await _initialOfferHandled.future;

    // Serialized: publish()/unpublish() are called from outside any
    // chain task (app code, via RavenRoom), unlike _flushDeferredPublishes,
    // which calls _negotiatePublish directly because it already runs
    // inside one. See _serialized's doc comment.
    await _serialized(_negotiatePublish);
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

    // Serialized: publish()/unpublish() are called from outside any
    // chain task (app code, via RavenRoom), unlike _flushDeferredPublishes,
    // which calls _negotiatePublish directly because it already runs
    // inside one. See _serialized's doc comment.
    await _serialized(_negotiatePublish);
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
    channel.onDataChannelState = (state) {
      if (state == rtc.RTCDataChannelState.RTCDataChannelOpen) {
        _settleDataChannelWaiters();
      }
    };
    // A channel that arrives already open — restored on a live
    // connection, or opened before this listener was attached — never
    // fires `onDataChannelState` for us.
    if (channel.state == rtc.RTCDataChannelState.RTCDataChannelOpen) {
      _settleDataChannelWaiters();
    }
  }

  /// Opens this participant's data channel if nothing has already, so a
  /// participant that only wants [data] gets one even though it never
  /// published or called [sendData].
  ///
  /// The SFU fans data out over each recipient's *own* channel (spec
  /// §18), so a participant who never opened one does not merely fail to
  /// send: they never receive anything either, since there is no channel
  /// for the SFU to relay onto. A channel is still opened on demand
  /// rather than unconditionally, since most calls never touch data at
  /// all and an SCTP association for every participant regardless is a
  /// cost with nothing behind it.
  Future<void> ensureDataChannel() async {
    if (_dataChannel != null) return;
    final pc = await _ensurePeerConnection();
    if (_dataChannel != null) return;
    final channel = await pc.createDataChannel(
      _dataChannelLabel,
      rtc.RTCDataChannelInit()..ordered = true,
    );
    _attachDataChannel(channel);

    // A data channel needs its own `m=application` section just like a
    // newly added track, but unlike publish()/unpublish() nothing else was
    // ever going to prompt an offer for a participant who only wants
    // [data]: it previously opened only by riding along behind some
    // unrelated publish's negotiation round, or never opened at all for a
    // participant that never published. Same race guard as publish() — a
    // caller here before the SFU's join-time offer has arrived must not
    // send a competing offer; see [_initialOfferHandled].
    await _initialOfferHandled.future;
    await _serialized(_negotiatePublish);
  }

  /// How long [sendData] waits for the data channel to open before giving
  /// up. Chosen to comfortably outlast one ordinary negotiation round
  /// trip without leaving a caller stuck for the length of a whole call:
  /// the data channel piggybacks on the same offer/answer machinery as
  /// every other negotiation here, so a channel that hasn't opened by
  /// then almost always means negotiation itself is stuck, and no amount
  /// of further waiting fixes that.
  static const _dataChannelOpenTimeout = Duration(seconds: 15);

  /// Resolves once the data channel is open.
  ///
  /// What [sendData] actually needs to wait for. A data channel needs its
  /// own `m=application` section, which costs a round trip before the
  /// first byte can go anywhere; a caller that does not wait for that and
  /// sends immediately either throws against a channel that is not open
  /// yet or, on platforms that buffer instead, has no way to know the
  /// payload has not actually left.
  ///
  /// Bounded by [_dataChannelOpenTimeout]: an unbounded wait here means
  /// that if negotiation itself never completes — a stuck round the
  /// caller has no other visibility into — [sendData] simply never
  /// returns, with no error and no way out short of the caller inventing
  /// its own timeout around a call that documents none.
  Future<void> _dataChannelOpened() {
    if (_dataChannel?.state == rtc.RTCDataChannelState.RTCDataChannelOpen) {
      return Future.value();
    }
    final completer = Completer<void>();
    _dataChannelWaiters.add(completer);
    return completer.future.timeout(
      _dataChannelOpenTimeout,
      onTimeout: () {
        _dataChannelWaiters.remove(completer);
        throw RavenException(
          RavenErrorCode.timeout,
          'The data channel did not open within '
          '${_dataChannelOpenTimeout.inSeconds}s.',
        );
      },
    );
  }

  void _settleDataChannelWaiters() {
    if (_dataChannelWaiters.isEmpty) return;
    final waiters = List.of(_dataChannelWaiters);
    _dataChannelWaiters.clear();
    for (final waiter in waiters) {
      if (!waiter.isCompleted) waiter.complete();
    }
  }

  /// Fails everyone waiting on the data channel, because it is never
  /// going to open.
  ///
  /// Only for a connection that is finished — a terminal signaling
  /// failure, or teardown. A reconnect deliberately does *not* come
  /// through here: [resetPeerConnection] drops the channel, but rejoining
  /// recreates it and settles the wait normally, so a [sendData] made
  /// mid-blip still goes out afterwards instead of throwing at the caller.
  void _abortDataChannelWaiters(RavenException error) {
    if (_dataChannelWaiters.isEmpty) return;
    final waiters = List.of(_dataChannelWaiters);
    _dataChannelWaiters.clear();
    for (final waiter in waiters) {
      if (!waiter.isCompleted) waiter.completeError(error);
    }
  }

  /// Sends a payload to everyone else in the room.
  ///
  /// Waits for the channel to finish opening rather than sending
  /// immediately: [rtc.RTCDataChannel.send] on a channel whose SCTP
  /// association has not yet come up either throws or, on platforms that
  /// buffer instead of rejecting, leaves the caller with no way to tell
  /// the payload actually left. Queuing the wait here means every payload
  /// sent before the channel opens still goes out, once it does, instead
  /// of being silently dropped.
  Future<void> sendData(List<int> payload) async {
    await ensureDataChannel();
    await _dataChannelOpened();

    final channel = _dataChannel;
    if (channel == null) {
      throw const RavenException(
        RavenErrorCode.connectionFailed,
        'sendData() requires an active connection.',
      );
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
    // Both belong to the connection just torn down. Nulling _pcCreating
    // stops *new* callers from joining a stale attempt; bumping the
    // generation is what stops that attempt itself from resurrecting
    // [_pc] once it finishes — see [_createPeerConnection].
    _pcCreating = null;
    _pcGeneration++;
    // A fresh generation means a fresh SFU session and a fresh join-time
    // offer to wait for — see [_initialOfferHandled]'s doc comment. A
    // completer already-completed for the *previous* connection would let
    // a post-reconnect publish() skip the wait entirely.
    _initialOfferHandled = Completer<void>();
    _glareRecoveryAttempted = false;
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
    await _lifecycle?.cancel();
    _abortDataChannelWaiters(const RavenException(
      RavenErrorCode.connectionFailed,
      'The connection was disposed before the data channel could open.',
    ));

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

/// The track id in the `a=msid:` line of the m-section with this `mid`.
///
/// `a=msid:<stream-id> <track-id>`; the stream-only form is legal and
/// names no track, and a section can carry no msid at all, so this
/// returns null rather than guessing. See [RavenEngine._remoteTrackIdFor]
/// for why this is read at all instead of trusting the platform's track
/// id.
String? _msidTrackIdForMid(String sdp, String mid) {
  final sections = sdp.split(RegExp(r'\r?\nm=')).skip(1);
  for (final section in sections) {
    final lines = section.split(RegExp(r'\r?\n'));
    if (!lines.any((line) => line.trim() == 'a=mid:$mid')) continue;

    final msidLine = lines.firstWhere(
      (line) => line.startsWith('a=msid:'),
      orElse: () => '',
    );
    if (msidLine.isEmpty) return null;
    final parts =
        msidLine.substring('a=msid:'.length).trim().split(RegExp(r'\s+'));
    return parts.length > 1 && parts[1].isNotEmpty ? parts[1] : null;
  }
  return null;
}
