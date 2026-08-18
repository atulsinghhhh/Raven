import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart' as lk;

import 'room.dart';
import 'types.dart';

/// Renders a participant's video.
///
/// ```dart
/// RavenVideoView(participant: remote, room: room)
/// ```
///
/// Rebuilds by itself as tracks are published, muted, or resubscribed —
/// pass [room] and the widget listens for you. Without a room it renders
/// once and stays put, which is right for a static thumbnail and wrong
/// for a call.
///
/// A stateful widget rather than a plain builder, because the underlying
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

  /// Whose video to show. Local or remote — the widget doesn't care.
  final RavenParticipant? participant;

  /// Pass the room to make the widget follow track changes.
  final RavenRoom? room;

  /// `camera` (default) or `screenShare`.
  final RavenTrackKind kind;

  final RavenVideoFit fit;

  /// Mirrors horizontally. Defaults to true for the local camera, which
  /// is what a user expects of their own preview, and false otherwise.
  final bool? mirror;

  /// Shown when there is no video — camera off, muted, or not yet
  /// published. Defaults to a plain black surface.
  final Widget? placeholder;

  @override
  State<RavenVideoView> createState() => _RavenVideoViewState();
}

enum RavenVideoFit { cover, contain }

class _RavenVideoViewState extends State<RavenVideoView> {
  lk.VideoTrack? _track;

  @override
  void initState() {
    super.initState();
    widget.room?.addListener(_syncTrack);
    _track = _resolveTrack();
  }

  @override
  void didUpdateWidget(RavenVideoView oldWidget) {
    super.didUpdateWidget(oldWidget);

    // The room can change when a screen is reused across calls. Moving
    // the listener is what stops the widget listening to a disposed room
    // — which throws on the next notification.
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
    super.dispose();
  }

  void _syncTrack() {
    if (!mounted) return;
    final next = _resolveTrack();
    if (identical(next, _track)) return;
    setState(() => _track = next);
  }

  lk.VideoTrack? _resolveTrack() =>
      widget.participant?.videoTrackFor(widget.kind);

  @override
  Widget build(BuildContext context) {
    final track = _track;

    if (track == null) {
      return widget.placeholder ?? const ColoredBox(color: Colors.black);
    }

    final mirror = widget.mirror ??
        (widget.kind == RavenTrackKind.camera &&
            (widget.participant?.isLocal ?? false));

    return lk.VideoTrackRenderer(
      track,
      // Keyed by the track's sid so replacing a track (a camera switch,
      // or a resubscribe after reconnect) builds a fresh renderer rather
      // than rebinding a texture that has already gone.
      key: ValueKey(track.sid),
      fit: widget.fit == RavenVideoFit.cover
          ? lk.VideoViewFit.cover
          : lk.VideoViewFit.contain,
      mirrorMode:
          mirror ? lk.VideoViewMirrorMode.mirror : lk.VideoViewMirrorMode.off,
    );
  }
}
