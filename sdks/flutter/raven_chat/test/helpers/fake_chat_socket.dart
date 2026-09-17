import 'dart:async';
import 'dart:convert';

import 'package:stream_channel/stream_channel.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// A chat socket a test drives directly.
///
/// [RavenChat] takes a `connectChannel` factory precisely so its protocol
/// — the hello handshake, room joins, typing and presence frames, the
/// reconnect — can be tested without a gateway. Only the handful of
/// members the client actually touches are implemented; `noSuchMethod`
/// covers the rest of [WebSocketChannel]'s surface, which it never
/// reaches for.
class FakeChatSocket extends StreamChannelMixin<dynamic>
    implements WebSocketChannel {
  // Closed by [drop], which every test reaches through either a socket
  // drop or the client's own teardown.
  // ignore: close_sinks
  final _incoming = StreamController<dynamic>.broadcast();

  /// Every frame the client sent, decoded, in order.
  final sent = <Map<String, dynamic>>[];

  int? _closeCode;

  @override
  Stream<dynamic> get stream => _incoming.stream;

  // Owned by this socket and torn down with it; there is nothing else
  // holding it to close.
  @override
  // ignore: close_sinks
  late final WebSocketSink sink = _FakeSink(this);

  @override
  int? get closeCode => _closeCode;

  @override
  String? get closeReason => null;

  @override
  String? get protocol => null;

  @override
  Future<void> get ready => Future<void>.value();

  /// Delivers the server's hello, which is what makes `connect()` resolve.
  void acceptConnection() => receive({'type': 'connected'});

  /// Acks whatever request is still outstanding, oldest first, so a
  /// `room.join` the client is awaiting actually completes.
  void ackPending() {
    for (final frame in sent) {
      final id = frame['id'];
      if (id is String) receive({'type': 'ack', 'id': id});
    }
  }

  void receive(Map<String, dynamic> frame) {
    if (_incoming.isClosed) return;
    _incoming.add(jsonEncode(frame));
  }

  /// The network dropping the connection, which is what drives a
  /// reconnect.
  void drop([int? code]) {
    _closeCode = code;
    if (!_incoming.isClosed) _incoming.close();
  }

  /// Frames of one type, in order.
  Iterable<Map<String, dynamic>> ofType(String type) =>
      sent.where((frame) => frame['type'] == type);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeSink implements WebSocketSink {
  _FakeSink(this._socket);

  final FakeChatSocket _socket;

  @override
  void add(dynamic data) =>
      _socket.sent.add(jsonDecode(data as String) as Map<String, dynamic>);

  @override
  Future<void> close([int? closeCode, String? closeReason]) async {
    _socket.drop(closeCode);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
