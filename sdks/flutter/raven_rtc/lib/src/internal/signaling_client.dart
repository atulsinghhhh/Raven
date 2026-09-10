import 'dart:async';
import 'dart:convert';
import 'dart:math';

import '../errors.dart';
import 'protocol.dart';

/// How long to wait for the socket to open, and for `room.joined` after.
///
/// Separate because they fail for different reasons: the first is "cannot
/// reach the API", the second is "the API cannot reach an RTC server". One
/// combined timeout would report both as the same thing.
const _openTimeout = Duration(seconds: 10);
const _joinTimeout = Duration(seconds: 15);

const _reconnectBase = Duration(milliseconds: 300);
const _reconnectMax = Duration(seconds: 10);
const _maxReconnectAttempts = 12;

/// The WebSocket close code the server uses for a rejected credential.
const _closeAuthFailed = 4001;

/// Opens a WebSocket. Injectable so tests can drive the protocol without a
/// server, and so the platform-specific implementation stays out of this
/// file.
typedef SocketFactory = Future<RavenSocket> Function(String url);

/// The slice of a WebSocket this client needs.
///
/// An interface, not `dart:io`'s or `dart:html`'s type: Flutter
/// runs on both, `package:web_socket_channel` abstracts them, and the
/// reconnect logic is worth testing without any of that.
abstract class RavenSocket {
  Stream<dynamic> get messages;
  void send(String data);
  Future<void> close([int? code, String? reason]);

  /// Resolves with the close code once the socket closes.
  Future<int?> get closed;
}

/// Supplies a fresh RTC token when the current one is rejected or a
/// reconnect is starting (spec §21).
typedef TokenRefresher = Future<String> Function();

/// The SDK's signaling connection.
///
/// Owns the socket, the join handshake, and reconnection, and nothing
/// else. It does not know what a peer connection is: every message is
/// handed to a listener, which decides what to negotiate. Keeping that
/// line clean is what makes reconnection testable without a WebRTC stack.
///
/// # Reconnection
///
/// A reconnect re-runs the whole join, because that is what the server
/// expects: the previous session's peer connection is gone, and
/// `room.join` allocates a fresh one. That is more work than resuming a
/// session, and it is deliberate: an ICE restart on a connection that has
/// already failed is less reliable than starting clean, and the client has
/// to handle a fresh session anyway when the network changed underneath it
/// (spec §20).
class SignalingClient {
  SignalingClient({
    required this.endpoint,
    required String token,
    required this.roomId,
    required this.autoReconnect,
    required SocketFactory socketFactory,
    this.region,
    this.refreshToken,
  })  : _token = token,
        _socketFactory = socketFactory;

  final String endpoint;
  final String roomId;
  final String? region;
  final bool autoReconnect;
  final TokenRefresher? refreshToken;

  final SocketFactory _socketFactory;
  String _token;

  RavenSocket? _socket;
  StreamSubscription<dynamic>? _subscription;
  int _reconnectAttempts = 0;
  Timer? _reconnectTimer;
  bool _closedByCaller = false;
  bool _joined = false;

  final _messages = StreamController<Map<String, dynamic>>.broadcast();
  final _joins = StreamController<JoinedPayload>.broadcast();
  final _states = StreamController<SignalingLifecycle>.broadcast();

  /// Every server message, already parsed.
  Stream<Map<String, dynamic>> get messages => _messages.stream;

  /// Fires on the first join and again after every successful reconnect.
  Stream<JoinedPayload> get joins => _joins.stream;

  /// Transport-level lifecycle, distinct from the media connection's.
  Stream<SignalingLifecycle> get lifecycle => _states.stream;

  bool get isJoined => _joined;

  /// Opens the socket and joins the room.
  ///
  /// Completes once `room.joined` arrives: not merely once the socket
  /// opens. A caller handed a completed future on socket-open would then
  /// have to await an event to know whether it was actually in the room,
  /// which is the same waiting with an extra step.
  Future<JoinedPayload> connect() {
    _closedByCaller = false;
    return _openAndJoin();
  }

  Future<JoinedPayload> _openAndJoin() async {
    final socket = await _open();
    _socket = socket;
    return _join(socket);
  }

  Future<RavenSocket> _open() async {
    try {
      return await _socketFactory(_url()).timeout(_openTimeout);
    } on TimeoutException catch (error) {
      throw RavenException(
        RavenErrorCode.timeout,
        'Timed out opening a signaling connection to $endpoint.',
        error,
      );
    } catch (error) {
      throw RavenException(
        RavenErrorCode.networkError,
        'Could not reach the Livqeno signaling endpoint at $endpoint.',
        error,
      );
    }
  }

  Future<JoinedPayload> _join(RavenSocket socket) {
    final completer = Completer<JoinedPayload>();

    _subscription = socket.messages.listen(
      (raw) {
        final message = _parse(raw);
        if (message == null) return;

        final type = message['type'];

        if (!completer.isCompleted) {
          if (type == ServerMessageType.roomJoined) {
            final payload = JoinedPayload.fromJson(message);
            _joined = true;
            _reconnectAttempts = 0;
            completer.complete(payload);
            _joins.add(payload);
            return;
          }
          if (type == ServerMessageType.error) {
            completer.completeError(_toException(message));
            return;
          }
        }

        _handle(message);
      },
      onError: (Object error) {
        if (!completer.isCompleted) {
          completer.completeError(RavenException(
            RavenErrorCode.signalingError,
            'The signaling connection failed.',
            error,
          ));
        }
      },
      cancelOnError: false,
    );

    // Watching `closed` rather than the stream's onDone: a close carries
    // the code, and 4001 (credential rejected) has to be told apart from
    // an ordinary drop so the token can be refreshed before retrying.
    unawaited(socket.closed.then((code) {
      _joined = false;
      if (!completer.isCompleted) {
        completer.completeError(RavenException(
          RavenErrorCode.signalingError,
          'The signaling connection closed before the room was joined '
          '(code ${code ?? 'unknown'}).',
        ));
      }
      _onClosed(code);
    }));

    send({
      'type': ClientMessageType.roomJoin,
      'roomId': roomId,
      if (region != null) 'region': region,
    });

    return completer.future.timeout(
      _joinTimeout,
      onTimeout: () => throw const RavenException(
        RavenErrorCode.timeout,
        'The server did not confirm the room join.',
      ),
    );
  }

  void _handle(Map<String, dynamic> message) {
    if (message['type'] == ServerMessageType.error) {
      final code = message['code'] as String? ?? '';
      if (SignalingErrorCode.fatal.contains(code)) {
        // Nothing a reconnect can fix. Close on purpose so the
        // reconnect path is not entered, and report it.
        _closedByCaller = true;
        _states.add(SignalingLifecycle.failed(_toException(message)));
        unawaited(_socket?.close());
        return;
      }
    }
    _messages.add(message);
  }

  void _onClosed(int? code) {
    if (_closedByCaller) {
      _states.add(const SignalingLifecycle.closed());
      return;
    }
    if (!autoReconnect) {
      _states.add(SignalingLifecycle.failed(RavenException(
        RavenErrorCode.networkError,
        'The signaling connection closed (code ${code ?? 'unknown'}).',
      )));
      return;
    }
    unawaited(_scheduleReconnect(refreshFirst: code == _closeAuthFailed));
  }

  Future<void> _scheduleReconnect({required bool refreshFirst}) async {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      _states.add(SignalingLifecycle.failed(const RavenException(
        RavenErrorCode.connectionFailed,
        'Could not re-establish signaling after $_maxReconnectAttempts attempts.',
      )));
      return;
    }

    _reconnectAttempts++;
    _states.add(const SignalingLifecycle.reconnecting());

    // Refreshed on the first attempt too, not only after a rejected
    // credential: a reconnect following a long outage very often has an
    // expired token, and discovering that by being rejected costs an
    // extra round trip and a confusing log line.
    if (refreshFirst || _reconnectAttempts == 1) {
      await _tryRefreshToken();
    }

    final backoffMs = min(
      _reconnectBase.inMilliseconds * pow(2, _reconnectAttempts - 1).toInt(),
      _reconnectMax.inMilliseconds,
    );
    // Full jitter: every client picks somewhere in [0, backoff), so a
    // fleet that all dropped at once does not all retry at once.
    final delay = Duration(milliseconds: Random().nextInt(backoffMs + 1));

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, () {
      _openAndJoin().catchError((Object _) {
        unawaited(_scheduleReconnect(refreshFirst: false));
        // The reconnect loop owns recovery; a failed attempt is not
        // surfaced on its own.
        return JoinedPayload(roomId: roomId, participants: const []);
      });
    });
  }

  Future<void> _tryRefreshToken() async {
    final refresher = refreshToken;
    if (refresher == null) return;
    try {
      _token = await refresher();
    } catch (_) {
      // Not fatal on its own: the existing token may still be valid, and
      // failing here would turn a recoverable blip into a dropped call.
    }
  }

  /// Replaces the token used by future reconnects (spec §21).
  void setToken(String token) => _token = token;

  void send(Map<String, dynamic> message) {
    final socket = _socket;
    if (socket == null ||
        !_joined && message['type'] != ClientMessageType.roomJoin) {
      // Dropped instead of queued. Every message here describes a moment
      // in a negotiation, and replaying a stale answer after a reconnect
      // would be worse than never sending it: the reconnect re-joins and
      // negotiates afresh.
      return;
    }
    try {
      socket.send(jsonEncode(message));
    } catch (_) {
      // The socket closed between the check and the write. The close
      // handler drives recovery.
    }
  }

  /// Leaves the room and closes the socket. Suppresses reconnection.
  Future<void> close() async {
    _closedByCaller = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;

    if (_socket != null && _joined) {
      send({'type': ClientMessageType.roomLeave});
    }
    _joined = false;

    await _subscription?.cancel();
    _subscription = null;
    await _socket?.close(1000, 'client left');
    _socket = null;
  }

  Future<void> dispose() async {
    await close();
    await _messages.close();
    await _joins.close();
    await _states.close();
  }

  String _url() {
    final base = endpoint.endsWith('/')
        ? endpoint.substring(0, endpoint.length - 1)
        : endpoint;
    // The token goes in a query parameter because a WebSocket handshake
    // cannot carry custom headers in a browser, and Flutter Web is a
    // supported target. It is short-lived by design for exactly this
    // reason, and the connection must be wss:// in production, which the
    // server's own configuration validation enforces.
    return '$base?token=${Uri.encodeQueryComponent(_token)}';
  }

  Map<String, dynamic>? _parse(dynamic raw) {
    if (raw is! String) {
      // Livqeno's signaling is text-only. A binary frame means something
      // else is on this socket, and guessing at it would be worse than
      // ignoring it.
      return null;
    }
    try {
      final parsed = jsonDecode(raw);
      return parsed is Map<String, dynamic> ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  RavenException _toException(Map<String, dynamic> message) {
    final code = message['code'] as String? ?? '';
    final text = message['message'] as String? ?? 'Signaling error.';

    return switch (code) {
      SignalingErrorCode.invalidToken =>
        RavenException(RavenErrorCode.invalidToken, text),
      SignalingErrorCode.tokenExpired =>
        RavenException(RavenErrorCode.tokenExpired, text),
      SignalingErrorCode.roomNotFound =>
        RavenException(RavenErrorCode.roomNotFound, text),
      SignalingErrorCode.unauthorized ||
      SignalingErrorCode.permissionDenied =>
        RavenException(RavenErrorCode.permissionDenied, text),
      SignalingErrorCode.roomFull ||
      SignalingErrorCode.noRtcCapacity ||
      SignalingErrorCode.rtcServerUnreachable =>
        RavenException(RavenErrorCode.connectionFailed, text),
      SignalingErrorCode.rateLimited =>
        RavenException(RavenErrorCode.networkError, text),
      _ => RavenException(RavenErrorCode.signalingError, text),
    };
  }
}

/// Transport lifecycle, separate from the media connection's state.
///
/// Two sealed variants, not an enum with a nullable error: a
/// failure without its cause is not actionable, and the type makes it
/// impossible to report one without the other.
sealed class SignalingLifecycle {
  const SignalingLifecycle();

  const factory SignalingLifecycle.reconnecting() = SignalingReconnecting;
  const factory SignalingLifecycle.closed() = SignalingClosed;
  const factory SignalingLifecycle.failed(RavenException error) =
      SignalingFailed;
}

class SignalingReconnecting extends SignalingLifecycle {
  const SignalingReconnecting();
}

class SignalingClosed extends SignalingLifecycle {
  const SignalingClosed();
}

class SignalingFailed extends SignalingLifecycle {
  const SignalingFailed(this.error);
  final RavenException error;
}
