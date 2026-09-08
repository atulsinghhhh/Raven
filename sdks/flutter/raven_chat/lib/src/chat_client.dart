import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'backoff.dart';
import 'errors.dart';
import 'models.dart';
import 'rest_client.dart';

/// Raven Chat for Flutter.
///
/// ```dart
/// final chat = RavenChat(token: token, apiUrl: apiUrl);
/// await chat.connect('room_123');
///
/// chat.messages.listen((message) => print(message.text));
/// await chat.send('Hello everyone!');
/// ```
///
/// The same guarantees as every other Raven Chat client, because it talks
/// to the same service over the same protocol (spec §9, no
/// mobile-specific chat backend):
///
/// * a message is only reported sent once it is durably stored;
/// * a retried send never creates a duplicate;
/// * a client that was offline catches up from history, not the socket;
/// * the socket is never the source of truth.
///
/// Extends [ChangeNotifier] so a widget can rebuild from it directly,
/// with typed streams for logic that lives outside the widget tree. That
/// dual surface is the idiomatic-Dart divergence the spec asks for (§6):
/// the concepts match the web SDK exactly, the subscription mechanism
/// follows the platform.
class RavenChat extends ChangeNotifier {
  RavenChat({
    required String token,
    String? apiUrl,
    String? chatUrl,
    this.maxReconnectAttempts = 10,
    this.requestTimeout = const Duration(seconds: 15),
    this.onTokenExpiring,
    @visibleForTesting WebSocketChannel Function(Uri uri)? connectChannel,
    @visibleForTesting RavenRestClient? restClient,
  })  : _token = token,
        _chatUrl = chatUrl ?? _deriveChatUrl(apiUrl),
        _connectChannel = connectChannel ?? WebSocketChannel.connect,
        _rest = restClient ??
            RavenRestClient(
              baseUrl: apiUrl ?? _deriveApiUrl(chatUrl),
              token: token,
            );

  /// Give up after this many consecutive failures and report [failed].
  /// Unbounded retries against a server that is already struggling is an
  /// attack, not a feature.
  final int maxReconnectAttempts;

  /// How long to wait for a server ack before failing a send.
  final Duration requestTimeout;

  /// Called shortly before the token expires. Return a fresh one and the
  /// client reconnects transparently. Without it, the socket simply
  /// closes when the token runs out.
  final Future<String> Function()? onTokenExpiring;

  final WebSocketChannel Function(Uri uri) _connectChannel;
  final RavenRestClient _rest;
  final String _chatUrl;

  String _token;
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _socketSubscription;
  Timer? _reconnectTimer;
  Timer? _tokenRefreshTimer;

  final _messageController = StreamController<RavenMessage>.broadcast();
  final _messageUpdatedController = StreamController<RavenMessage>.broadcast();
  final _messageDeletedController = StreamController<String>.broadcast();
  final _typingController = StreamController<RavenTypingEvent>.broadcast();
  final _presenceController = StreamController<RavenPresence>.broadcast();
  final _reactionController = StreamController<RavenReactionEvent>.broadcast();
  final _readController = StreamController<RavenReadState>.broadcast();
  final _stateController =
      StreamController<RavenChatConnectionState>.broadcast();
  final _errorController = StreamController<RavenChatException>.broadcast();

  /// Requests awaiting a correlated ack, keyed by frame id.
  final _pending = <String, Completer<Map<String, dynamic>>>{};

  /// Rooms the caller asked to be in. Re-joined automatically after a
  /// reconnect, since the new socket knows nothing of the old one's
  /// subscriptions.
  final _desiredRooms = <String>{};

  RavenChatConnectionState _state = RavenChatConnectionState.idle;
  int _requestCounter = 0;
  int _reconnectAttempt = 0;
  bool _intentionallyClosed = false;
  bool _disposed = false;
  Completer<void>? _connected;

  // ---------------------------------------------------------------------
  // Streams
  // ---------------------------------------------------------------------

  /// Messages as they arrive, your own included, echoed back.
  ///
  /// Receiving your own message is deliberate: the sender renders the
  /// same canonical, server-ordered row as everyone else instead of a
  /// local optimistic copy that has to be reconciled later.
  Stream<RavenMessage> get messages => _messageController.stream;

  Stream<RavenMessage> get messageUpdates => _messageUpdatedController.stream;

  /// Ids of messages that were deleted.
  Stream<String> get messageDeletions => _messageDeletedController.stream;

  Stream<RavenTypingEvent> get typing => _typingController.stream;
  Stream<RavenPresence> get presence => _presenceController.stream;
  Stream<RavenReactionEvent> get reactions => _reactionController.stream;
  Stream<RavenReadState> get readReceipts => _readController.stream;
  Stream<RavenChatConnectionState> get connectionStateChanges =>
      _stateController.stream;

  /// Errors that weren't tied to a call you made, a reconnect giving up for
  /// instance. An error from a specific call rejects that call's future.
  Stream<RavenChatException> get errors => _errorController.stream;

  RavenChatConnectionState get connectionState => _state;

  /// Rooms currently joined.
  Set<String> get rooms => Set.unmodifiable(_desiredRooms);

  // ---------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------

  /// Connects and joins [room].
  ///
  /// Completes once the server has authenticated the socket, not merely once
  /// the TCP connection opened, so a completed future genuinely means you
  /// can send.
  Future<void> connect(String room) async {
    _desiredRooms.add(room);

    if (_state == RavenChatConnectionState.connected) {
      await _joinRoom(room);
      return;
    }

    _intentionallyClosed = false;
    await _openSocket();
    await _syncRooms();
  }

  /// Closes the connection. Does not reconnect; call [connect] again.
  Future<void> disconnect() async {
    _intentionallyClosed = true;
    _reconnectTimer?.cancel();
    _tokenRefreshTimer?.cancel();

    await _teardownSocket();
    _failPending(
      const RavenChatException(
        RavenChatErrorCode.connectionClosed,
        'The connection was closed before the server replied.',
      ),
    );
    _setState(RavenChatConnectionState.disconnected);
  }

  /// Leaves a room but keeps the connection open.
  Future<void> leaveRoom(String room) async {
    _desiredRooms.remove(room);
    if (_state == RavenChatConnectionState.connected) {
      await _request('room.leave', {'room': room});
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;

    _intentionallyClosed = true;
    _reconnectTimer?.cancel();
    _tokenRefreshTimer?.cancel();
    unawaited(_teardownSocket());
    unawaited(_rest.close());

    _messageController.close();
    _messageUpdatedController.close();
    _messageDeletedController.close();
    _typingController.close();
    _presenceController.close();
    _reactionController.close();
    _readController.close();
    _stateController.close();
    _errorController.close();

    super.dispose();
  }

  // ---------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------

  /// Sends a message and completes with the stored message.
  ///
  /// Completes only after Raven has durably stored it, so a completed
  /// future really does mean "saved". The returned message carries the
  /// server's canonical id and timestamp.
  ///
  /// A [clientMessageId] is attached automatically when you don't supply
  /// one, which is what makes a retry after a reconnect safe: the same key
  /// returns the original message instead of posting a duplicate.
  Future<RavenMessage> send(
    String text, {
    String? room,
    String? replyTo,
    String? clientMessageId,
    Map<String, dynamic>? metadata,
  }) async {
    final target = room ?? _defaultRoom();
    final idempotencyKey = clientMessageId ?? _generateClientMessageId();

    // Over HTTP when the socket is down. Losing connectivity shouldn't
    // silently lose what the user just typed. The message still stores
    // and still fans out to everyone else.
    if (_state != RavenChatConnectionState.connected) {
      final response = await _rest.post(
        '/v1/chat/conversations/${Uri.encodeComponent(target)}/messages',
        body: {
          'text': text,
          if (replyTo != null) 'replyTo': replyTo,
          'clientMessageId': idempotencyKey,
          if (metadata != null) 'metadata': metadata,
        },
      );
      return RavenMessage.fromJson(response);
    }

    final ack = await _request('message.send', {
      'room': target,
      'text': text,
      if (replyTo != null) 'replyTo': replyTo,
      'clientMessageId': idempotencyKey,
      if (metadata != null) 'metadata': metadata,
      'clientSentAt': DateTime.now().millisecondsSinceEpoch,
    });

    return RavenMessage.fromJson(ack['message'] as Map<String, dynamic>);
  }

  /// Message history, newest first.
  ///
  /// Pass [before] (a previous page's `nextCursor`) to page back through
  /// history, or [after] (its `previousCursor`) to catch up on what
  /// arrived while disconnected. Cursors are opaque, so pass back exactly
  /// what you were given.
  Future<RavenMessagePage> history({
    String? room,
    int limit = 50,
    String? before,
    String? after,
    String? threadRootId,
  }) async {
    final target = room ?? _defaultRoom();
    final response = await _rest.get(
      '/v1/chat/conversations/${Uri.encodeComponent(target)}/messages',
      query: {
        'limit': '$limit',
        if (before != null) 'before': before,
        if (after != null) 'after': after,
        if (threadRootId != null) 'threadRootId': threadRootId,
      },
    );
    return RavenMessagePage.fromJson(response);
  }

  /// Every message in a thread, oldest first: the root plus its replies.
  ///
  /// Works from any message in the thread, not just the root.
  Future<List<RavenMessage>> thread(String messageId) async {
    final response = await _rest
        .getList('/v1/chat/messages/${Uri.encodeComponent(messageId)}/thread');
    return response
        .map((value) => RavenMessage.fromJson(value as Map<String, dynamic>))
        .toList(growable: false);
  }

  /// Edits a message. The result carries `edited: true` and an
  /// `editedAt`. Raven never quietly rewrites history.
  Future<RavenMessage> edit(String messageId, String text) async {
    final response = await _rest.patch(
      '/v1/chat/messages/${Uri.encodeComponent(messageId)}',
      body: {'text': text},
    );
    return RavenMessage.fromJson(response);
  }

  /// Soft-deletes a message. It keeps its position and id but loses its
  /// body, so a client can render a placeholder instead of leaving a hole
  /// in the conversation.
  Future<RavenMessage> delete(String messageId) async {
    final response = await _rest
        .delete('/v1/chat/messages/${Uri.encodeComponent(messageId)}');
    return RavenMessage.fromJson(response);
  }

  /// Adds a reaction. Adding the same one twice is a no-op, not a
  /// duplicate.
  Future<void> addReaction(String messageId, String emoji) async {
    await _rest.post(
      '/v1/chat/messages/${Uri.encodeComponent(messageId)}/reactions',
      body: {'emoji': emoji},
    );
  }

  Future<void> removeReaction(String messageId, String emoji) async {
    await _rest.delete(
      '/v1/chat/messages/${Uri.encodeComponent(messageId)}/reactions/${Uri.encodeComponent(emoji)}',
    );
  }

  // ---------------------------------------------------------------------
  // Presence, typing, read state
  // ---------------------------------------------------------------------

  /// Signals that the user is typing.
  ///
  /// Safe to call on every keystroke: the server only broadcasts on the
  /// transition into typing, and its state expires on a TTL so a client
  /// that vanishes mid-sentence doesn't leave a stuck indicator.
  Future<void> startTyping({String? room}) async {
    _sendFrame({'type': 'typing.start', 'room': room ?? _defaultRoom()});
  }

  Future<void> stopTyping({String? room}) async {
    _sendFrame({'type': 'typing.stop', 'room': room ?? _defaultRoom()});
  }

  /// Marks this message, and everything before it, as read.
  Future<void> markAsRead(String messageId) async {
    if (_state == RavenChatConnectionState.connected) {
      await _request('read.mark', {'messageId': messageId});
      return;
    }
    await _rest
        .post('/v1/chat/messages/${Uri.encodeComponent(messageId)}/read');
  }

  /// Who's present in a room right now. Ephemeral; never durable state.
  Future<List<RavenPresence>> getPresence({String? room}) async {
    final target = room ?? _defaultRoom();
    final response = await _rest.getList(
        '/v1/chat/conversations/${Uri.encodeComponent(target)}/presence');
    return response
        .map((value) => RavenPresence.fromJson(value as Map<String, dynamic>))
        .toList(growable: false);
  }

  /// Sets presence across every room this connection holds.
  Future<void> setPresence(RavenPresenceStatus status) async {
    _sendFrame({'type': 'presence.set', 'status': status.name});
  }

  // ---------------------------------------------------------------------
  // Socket plumbing
  // ---------------------------------------------------------------------

  Future<void> _openSocket() async {
    _setState(_reconnectAttempt > 0
        ? RavenChatConnectionState.reconnecting
        : RavenChatConnectionState.connecting);

    final uri = Uri.parse(
      '$_chatUrl?token=${Uri.encodeQueryComponent(_token)}&sdkVersion=$_sdkVersion&platform=flutter',
    );

    final connected = Completer<void>();
    _connected = connected;

    try {
      final channel = _connectChannel(uri);
      _channel = channel;

      _socketSubscription = channel.stream.listen(
        _handleFrame,
        onDone: _handleSocketClosed,
        onError: (Object error) {
          // Errors are informational here; the close that follows is what
          // actually drives reconnection.
          debugPrint('[raven_chat] socket error: $error');
        },
        cancelOnError: false,
      );
    } catch (error) {
      _connected = null;
      _scheduleReconnect();
      throw RavenChatException(
        RavenChatErrorCode.connectionFailed,
        'Could not open a chat connection.',
        cause: error,
      );
    }

    return connected.future;
  }

  Future<void> _teardownSocket() async {
    // Cancel the subscription before closing, so the close doesn't drive
    // the reconnect path we're by design leaving.
    await _socketSubscription?.cancel();
    _socketSubscription = null;

    await _channel?.sink.close();
    _channel = null;
  }

  void _handleFrame(dynamic raw) {
    Map<String, dynamic> frame;
    try {
      frame = jsonDecode(raw as String) as Map<String, dynamic>;
    } catch (_) {
      debugPrint('[raven_chat] discarded a malformed frame');
      return;
    }

    final type = frame['type'] as String?;

    switch (type) {
      case 'connected':
        _handleServerHello(frame);
        return;

      case 'ack':
        _resolvePending(frame['id'] as String?, frame['data']);
        return;

      case 'error':
        _handleErrorFrame(frame);
        return;

      case 'room.joined':
      case 'room.left':
        _resolvePending(frame['id'] as String?, frame);
        return;

      case 'message':
        _emit(_messageController,
            RavenMessage.fromJson(frame['message'] as Map<String, dynamic>));
        return;

      case 'message.updated':
        _emit(_messageUpdatedController,
            RavenMessage.fromJson(frame['message'] as Map<String, dynamic>));
        return;

      case 'message.deleted':
        _emit(_messageDeletedController, frame['messageId'] as String);
        return;

      case 'reaction.added':
      case 'reaction.removed':
        _emit(
          _reactionController,
          RavenReactionEvent(
            messageId: frame['messageId'] as String,
            roomId: frame['roomId'] as String? ?? '',
            userId: frame['userId'] as String? ?? '',
            emoji: frame['emoji'] as String? ?? '',
            added: type == 'reaction.added',
          ),
        );
        return;

      case 'typing.started':
      case 'typing.stopped':
        _emit(
          _typingController,
          RavenTypingEvent(
            roomId: frame['roomId'] as String? ?? '',
            userId: frame['userId'] as String? ?? '',
            isTyping: type == 'typing.started',
          ),
        );
        return;

      case 'presence':
        _emit(_presenceController, RavenPresence.fromJson(frame));
        return;

      case 'read':
        _emit(_readController, RavenReadState.fromJson(frame));
        return;

      case 'pong':
        return;

      default:
        // Forward compatibility: a newer server may send frames this
        // version predates. Ignoring beats throwing on an upgrade the
        // developer didn't ask for.
        debugPrint('[raven_chat] ignoring unknown frame "$type"');
    }
  }

  void _handleServerHello(Map<String, dynamic> frame) {
    _reconnectAttempt = 0;
    _setState(RavenChatConnectionState.connected);
    _scheduleTokenRefresh(frame['expiresAt'] as String?);

    _connected?.complete();
    _connected = null;
  }

  void _handleErrorFrame(Map<String, dynamic> frame) {
    final error = RavenChatException.fromServer(frame);
    final id = frame['id'] as String?;

    // This correlates to a call the developer made, so reject that future
    // rather than fire a global error they can't tie back to anything.
    final pending = id == null ? null : _pending.remove(id);
    if (pending != null) {
      pending.completeError(error);
      return;
    }

    _emit(_errorController, error);
  }

  void _handleSocketClosed() {
    // Read the close code *before* dropping the channel, because reading it
    // afterwards always yields null, which would silently turn a
    // terminal auth rejection into an endless reconnect loop.
    final closeCode = _channel?.closeCode;
    _channel = null;

    _failPending(
      const RavenChatException(
        RavenChatErrorCode.connectionClosed,
        'The connection closed before the server replied.',
      ),
    );

    if (_intentionallyClosed) {
      _setState(RavenChatConnectionState.disconnected);
      return;
    }

    // 4401 (auth failed) and 4403 (origin rejected) are refusals retrying
    // cannot fix. Reconnecting on a revoked token is a polite
    // denial-of-service against ourselves.
    if (closeCode == 4401 || closeCode == 4403) {
      _setState(RavenChatConnectionState.failed);
      _emit(
        _errorController,
        const RavenChatException(
          RavenChatErrorCode.unauthorized,
          'The chat connection was rejected. Mint a new token.',
        ),
      );
      return;
    }

    _connected?.completeError(
      const RavenChatException(
        RavenChatErrorCode.connectionClosed,
        'The chat connection closed.',
      ),
    );
    _connected = null;

    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_intentionallyClosed || _disposed) return;

    if (_reconnectAttempt >= maxReconnectAttempts) {
      _setState(RavenChatConnectionState.failed);
      _emit(
        _errorController,
        RavenChatException(
          RavenChatErrorCode.connectionFailed,
          'Could not reconnect after $maxReconnectAttempts attempts.',
        ),
      );
      return;
    }

    _reconnectAttempt += 1;
    _setState(RavenChatConnectionState.reconnecting);

    final delay = backoffDelay(_reconnectAttempt);
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, () async {
      try {
        await _openSocket();
        await _syncRooms();
      } catch (_) {
        // _openSocket already scheduled the next attempt.
      }
    });
  }

  Future<void> _syncRooms() async {
    for (final room in _desiredRooms) {
      try {
        await _joinRoom(room);
      } catch (error) {
        // One unauthorized room must not stop the others joining.
        if (error is RavenChatException) {
          _emit(_errorController, error);
        }
      }
    }
  }

  Future<void> _joinRoom(String room) => _request('room.join', {'room': room});

  Future<Map<String, dynamic>> _request(
    String type,
    Map<String, dynamic> payload,
  ) async {
    final channel = _channel;
    if (channel == null) {
      throw const RavenChatException(
        RavenChatErrorCode.connectionClosed,
        'Not connected — call connect() first.',
      );
    }

    final id = 'r${++_requestCounter}';
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;

    channel.sink.add(jsonEncode({'type': type, 'id': id, ...payload}));

    return completer.future.timeout(
      requestTimeout,
      onTimeout: () {
        _pending.remove(id);
        throw const RavenChatException(
          RavenChatErrorCode.timeout,
          'The server did not respond in time.',
        );
      },
    );
  }

  /// Fire-and-forget frames: typing and presence.
  ///
  /// Dropped instead of queued when disconnected. Both are ephemeral by
  /// nature, and replaying them after a reconnect would deliver signals
  /// that were true a minute ago.
  void _sendFrame(Map<String, dynamic> frame) {
    final channel = _channel;
    if (channel == null || _state != RavenChatConnectionState.connected) {
      return;
    }
    channel.sink.add(jsonEncode(frame));
  }

  void _resolvePending(String? id, Object? data) {
    if (id == null) return;
    final completer = _pending.remove(id);
    completer?.complete(
      data is Map<String, dynamic> ? data : <String, dynamic>{},
    );
  }

  void _failPending(RavenChatException error) {
    for (final completer in _pending.values) {
      if (!completer.isCompleted) {
        completer.completeError(error);
      }
    }
    _pending.clear();
  }

  void _scheduleTokenRefresh(String? expiresAt) {
    _tokenRefreshTimer?.cancel();

    final refresh = onTokenExpiring;
    if (refresh == null || expiresAt == null) return;

    final expiry = DateTime.tryParse(expiresAt);
    if (expiry == null) return;

    // A minute of headroom, never less than five seconds out, so a
    // short-lived token can't schedule its refresh in the past.
    final target = expiry.subtract(const Duration(minutes: 1));
    final delay = target.difference(DateTime.now());
    final wait =
        delay < const Duration(seconds: 5) ? const Duration(seconds: 5) : delay;

    _tokenRefreshTimer = Timer(wait, () async {
      try {
        final fresh = await refresh();
        _token = fresh;
        _rest.token = fresh;

        // Reconnect with the new token. The socket authenticated with the
        // old one stays valid until it expires, so this is a clean swap
        // rather than a race.
        await _teardownSocket();
        await _openSocket();
        await _syncRooms();
      } catch (error) {
        _emit(
          _errorController,
          RavenChatException(
            RavenChatErrorCode.tokenExpired,
            'Could not refresh the chat token.',
            cause: error,
          ),
        );
      }
    });
  }

  String _defaultRoom() {
    if (_desiredRooms.isEmpty) {
      throw const RavenChatException(
        RavenChatErrorCode.notInRoom,
        'No room selected — pass a room, or call connect(room) first.',
      );
    }
    return _desiredRooms.first;
  }

  void _setState(RavenChatConnectionState next) {
    if (_state == next || _disposed) return;
    _state = next;
    _emit(_stateController, next);
    notifyListeners();
  }

  void _emit<T>(StreamController<T> controller, T value) {
    if (_disposed || controller.isClosed) return;
    controller.add(value);
  }

  String _generateClientMessageId() {
    final random = Random();
    final suffix =
        List.generate(8, (_) => random.nextInt(36).toRadixString(36)).join();
    return 'cm_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}$suffix';
  }
}

const String _sdkVersion = '0.1.0';

/// `https://api.example.com` -> `wss://api.example.com/v1/chat/ws`
String _deriveChatUrl(String? apiUrl) {
  if (apiUrl == null) {
    throw ArgumentError(
      'RavenChat needs either apiUrl or chatUrl — both come from your '
      'backend\'s token-mint response.',
    );
  }
  final ws = apiUrl
      .replaceFirst(RegExp(r'^http:'), 'ws:')
      .replaceFirst(RegExp(r'^https:'), 'wss:')
      .replaceAll(RegExp(r'/$'), '');
  return '$ws/v1/chat/ws';
}

/// The inverse, so passing only `chatUrl` still gives working REST calls.
String _deriveApiUrl(String? chatUrl) {
  if (chatUrl == null) {
    throw ArgumentError(
      'RavenChat needs either apiUrl or chatUrl — both come from your '
      'backend\'s token-mint response.',
    );
  }
  return chatUrl
      .replaceFirst(RegExp(r'^ws:'), 'http:')
      .replaceFirst(RegExp(r'^wss:'), 'https:')
      .replaceFirst(RegExp(r'/v1/chat/ws$'), '');
}
