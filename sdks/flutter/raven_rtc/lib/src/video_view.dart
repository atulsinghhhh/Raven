import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' as rtc;

import 'dart:async';

import 'room.dart';
import 'types.dart';

/// Renders a participant's video.
///
/// ```dart
/// RavenVideoView(participant: remote, room: room)
/// ```
///
/// Rebuilds by itself as tracks are published, muted, or resubscribed;
/// pass [room] and the widget listens for you. Without a room it renders
/// once and stays put, which is right for a static thumbnail and wrong
/// for a call.
///
/// A stateful widget instead of a plain builder, because the underlying
/// renderer holds a native texture that has to be created and disposed in
/// step with the widget's own lifecycle. Getting that wrong leaks a
/// native view per rebuild (spec §19).
class RavenVideoView extends StatefulWidget {
  const RavenVideoView({
    super.key,
    required this.participant,
    this.room,
    this.kind = RavenTrackKind.camera,
    this.fit = RavenVideoFit.cover,
    this.mirror,
    this.placeholder,
  });

  /// Whose video to show. Local or remote: the widget doesn't care.
  final RavenParticipant? participant;

  /// Pass the room to make the widget follow track changes.
  final RavenRoom? room;

  /// `camera` (default) or `screenShare`.
  final RavenTrackKind kind;

  final RavenVideoFit fit;

  /// Mirrors horizontally. Defaults to true for the local camera, which
  /// is what a user expects of their own preview, and false otherwise.
  final bool? mirror;

  /// Shown when there is no video: camera off, muted, or not yet
  /// published. Defaults to a plain black surface.
  final Widget? placeholder;

  @override
  State<RavenVideoView> createState() => _RavenVideoViewState();
}

enum RavenVideoFit { cover, contain }

class _RavenVideoViewState extends State<RavenVideoView> {
  RavenRenderableTrack? _track;

  /// The renderer owns a native texture, so it is created and disposed in
  /// step with this State, not per build. Rebuilding one per frame
  /// leaks a native view each time (spec §19).
  final _renderer = rtc.RTCVideoRenderer();
  bool _rendererReady = false;

  @override
  void initState() {
    super.initState();
    widget.room?.addListener(_syncTrack);
    _track = _resolveTrack();
    unawaited(_initRenderer());
  }

  Future<void> _initRenderer() async {
    await _renderer.initialize();
    if (!mounted) {
      await _renderer.dispose();
      return;
    }
    setState(() {
      _rendererReady = true;
      _renderer.srcObject = _track?.stream;
    });
  }

  @override
  void didUpdateWidget(RavenVideoView oldWidget) {
    super.didUpdateWidget(oldWidget);

    // The room can change when a screen is reused across calls. Moving
    // the listener is what stops the widget listening to a disposed room
    //, which throws on the next notification.
    if (oldWidget.room != widget.room) {
      oldWidget.room?.removeListener(_syncTrack);
      widget.room?.addListener(_syncTrack);
    }

    if (oldWidget.participant != widget.participant ||
        oldWidget.kind != widget.kind) {
      _syncTrack();
    }
  }

  @override
  void dispose() {
    // Without this the room keeps a reference to a dead State object,
    // and every scrolled-away tile stays subscribed forever.
    widget.room?.removeListener(_syncTrack);
    // Detached before disposing: a renderer disposed while still bound to
    // a live stream can outlive its texture on the platform side.
    _renderer.srcObject = null;
    unawaited(_renderer.dispose());
    super.dispose();
  }

  void _syncTrack() {
    if (!mounted) return;
    final next = _resolveTrack();
    if (next?.trackId == _track?.trackId) return;

    setState(() {
      _track = next;
      if (_rendererReady) {
        _renderer.srcObject = next?.stream;
      }
    });
  }

  RavenRenderableTrack? _resolveTrack() =>
      widget.participant?.videoTrackFor(widget.kind);

  @override
  Widget build(BuildContext context) {
    final track = _track;

    if (track == null || !_rendererReady) {
      return widget.placeholder ?? const ColoredBox(color: Colors.black);
    }

    final mirror = widget.mirror ??
        (widget.kind == RavenTrackKind.camera &&
            (widget.participant?.isLocal ?? false));

    // Reports its own size to the room so adaptive streaming can ask for
    // a layer that matches what is actually on screen: the "viewport"
    // input spec §15 lists. A thumbnail asking for 1080p is the exact
    // waste this avoids.
    return LayoutBuilder(
      builder: (context, constraints) {
        _requestLayerFor(constraints);
        return rtc.RTCVideoView(
          _renderer,
          // Keyed by the track id so replacing a track (a camera switch,
          // or a resubscribe after reconnect) builds a fresh view rather
          // than rebinding a texture that has already gone.
          key: ValueKey(track.trackId),
          objectFit: widget.fit == RavenVideoFit.cover
              ? rtc.RTCVideoViewObjectFit.RTCVideoViewObjectFitCover
              : rtc.RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
          mirror: mirror,
        );
      },
    );
  }

  /// Asks for the smallest layer that still covers this view.
  ///
  /// A preference, not a command: the SFU will not hand over a layer the
  /// publisher is not sending. Only sent for remote tracks: asking for a
  /// layer of your own camera would be asking the server to change what
  /// you are sending.
  void _requestLayerFor(BoxConstraints constraints) {
    final room = widget.room;
    final participant = widget.participant;
    if (room == null || participant == null || participant.isLocal) return;

    final width = constraints.maxWidth;
    if (!width.isFinite || width <= 0) return;

    final layer = switch (width) {
      < 240 => 'low',
      < 640 => 'medium',
      _ => 'high',
    };
    if (layer == _requestedLayer) return;
    _requestedLayer = layer;
    room.requestLayer(participant, widget.kind, layer);
  }

  String? _requestedLayer;
}
