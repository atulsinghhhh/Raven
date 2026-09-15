import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';
import 'package:raven_chat/raven_chat.dart';

/// Real end-to-end check for the *published* `raven_chat` package
/// (pub.dev, not a path dependency) on Flutter Web. Mirrors the remote
/// control pattern `flutter_check/live_host` uses for `raven_rtc`/
/// `raven_live`: every state transition is mirrored to `window.__state`,
/// and a battery of JS-callable actions (`window.__doSend`, etc.) let a
/// Playwright-driven test exercise the real client instead of a mock.
///
/// Credentials arrive as URL query parameters: `token`, `apiUrl`, `room`.
void main() {
  _publishState({'phase': 'booting'});
  runApp(const _ChatApp());
}

final _stateKeys = <String>{};

void _publishState(Map<String, Object?> patch) {
  final existing = globalContext.getProperty('__state'.toJS) as JSObject?;
  final merged = <String, Object?>{};
  if (existing != null) {
    for (final key in _stateKeys) {
      final value = existing.getProperty(key.toJS);
      if (value != null) merged[key] = value.dartify();
    }
  }
  merged.addAll(patch);
  for (final key in patch.keys) {
    if (!_stateKeys.contains(key)) _stateKeys.add(key);
  }
  globalContext.setProperty('__state'.toJS, merged.jsify());
  webConsoleLog('[flutter-chat] ${jsonEncode(patch)}');
}

void _appendState(String listKey, Map<String, Object?> item) {
  final existing = globalContext.getProperty('__state'.toJS) as JSObject?;
  final currentList = existing?.getProperty(listKey.toJS)?.dartify() as List<dynamic>?;
  final next = [...(currentList ?? const []), item];
  _publishState({listKey: next});
}

@JS('console.log')
external void webConsoleLog(String message);

Map<String, Object?> _messageJson(RavenMessage m) => {
      'id': m.id,
      'roomId': m.roomId,
      'senderId': m.senderId,
      'type': m.type.name,
      'text': m.text,
      'replyTo': m.replyTo,
      'threadRootId': m.threadRootId,
      'clientMessageId': m.clientMessageId,
      'edited': m.edited,
      'deleted': m.deleted,
      'createdAt': m.createdAt.toIso8601String(),
    };

class _ChatApp extends StatelessWidget {
  const _ChatApp();

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(home: Scaffold(body: Center(child: _ChatRunner())));
  }
}

class _ChatRunner extends StatefulWidget {
  const _ChatRunner();

  @override
  State<_ChatRunner> createState() => _ChatRunnerState();
}

class _ChatRunnerState extends State<_ChatRunner> {
  String _summary = 'booting';
  RavenChat? _chat;

  @override
  void initState() {
    super.initState();
    _run();
  }

  void _fail(String code, String message) {
    _publishState({
      'phase': 'failed',
      'error': {'code': code, 'message': message},
    });
    setState(() => _summary = 'failed: $code — $message');
  }

  Future<void> _run() async {
    final params = Uri.base.queryParameters;
    final token = params['token'];
    final apiUrl = params['apiUrl'];
    final room = params['room'];
    if (token == null || apiUrl == null || room == null) {
      _fail('missing_params', 'Expected `token`, `apiUrl` and `room` query parameters.');
      return;
    }

    final chat = RavenChat(token: token, apiUrl: apiUrl);
    _chat = chat;

    chat.connectionStateChanges.listen((state) => _publishState({'connectionState': state.name}));
    chat.errors.listen((error) => _appendState('errors', {'code': error.code.name, 'message': error.message}));
    chat.messages.listen((m) => _appendState('messages', _messageJson(m)));
    chat.messageUpdates.listen((m) => _appendState('messageUpdates', _messageJson(m)));
    chat.messageDeletions.listen((id) => _appendState('messageDeletions', {'id': id}));
    chat.typing.listen((e) => _appendState('typingEvents', {'roomId': e.roomId, 'userId': e.userId, 'isTyping': e.isTyping}));
    chat.presence.listen((p) => _appendState('presenceEvents', {'userId': p.userId, 'status': p.status.name}));
    chat.reactions.listen((e) => _appendState('reactionEvents',
        {'messageId': e.messageId, 'roomId': e.roomId, 'userId': e.userId, 'emoji': e.emoji, 'added': e.added}));
    chat.readReceipts.listen((r) => _appendState('readReceipts',
        {'roomId': r.roomId, 'userId': r.userId, 'lastReadMessageId': r.lastReadMessageId, 'unreadCount': r.unreadCount}));

    _registerJsBridge(chat, room);

    try {
      _publishState({'phase': 'connecting', 'room': room});
      await chat.connect(room);
      _publishState({'phase': 'ready', 'ready': true, 'connectionState': chat.connectionState.name});
      setState(() => _summary = 'ready: ${chat.connectionState.name}');
    } catch (error) {
      _fail('connect_failed', 'RavenChat.connect threw: $error');
    }
  }

  void _registerJsBridge(RavenChat chat, String defaultRoom) {
    globalContext.setProperty(
      '__doSend'.toJS,
      ((JSString text) {
        // ignore: discarded_futures
        chat.send(text.toDart).then(
              (m) => _publishState({'lastSent': _messageJson(m)}),
              onError: (Object e) => _publishState({'sendError': e.toString()}),
            );
      }).toJS,
    );

    globalContext.setProperty(
      '__doHistory'.toJS,
      ((JSString beforeCursor) {
        final before = beforeCursor.toDart.isEmpty ? null : beforeCursor.toDart;
        // ignore: discarded_futures
        chat.history(room: defaultRoom, before: before).then(
          (page) => _publishState({
            'lastHistory': {
              'messages': page.messages.map(_messageJson).toList(),
              'nextCursor': page.nextCursor,
              'previousCursor': page.previousCursor,
              'hasMore': page.hasMore,
            },
          }),
          onError: (Object e) => _publishState({'historyError': e.toString()}),
        );
      }).toJS,
    );

    globalContext.setProperty(
      '__doEdit'.toJS,
      ((JSString id, JSString text) {
        // ignore: discarded_futures
        chat.edit(id.toDart, text.toDart).then(
              (m) => _publishState({'lastEdited': _messageJson(m)}),
              onError: (Object e) => _publishState({'editError': e.toString()}),
            );
      }).toJS,
    );

    globalContext.setProperty(
      '__doDelete'.toJS,
      ((JSString id) {
        // ignore: discarded_futures
        chat.delete(id.toDart).then(
              (m) => _publishState({'lastDeleted': _messageJson(m)}),
              onError: (Object e) => _publishState({'deleteError': e.toString()}),
            );
      }).toJS,
    );

    globalContext.setProperty(
      '__doAddReaction'.toJS,
      ((JSString id, JSString emoji) {
        // ignore: discarded_futures
        chat.addReaction(id.toDart, emoji.toDart).then(
              (_) => _publishState({'lastReactionAdded': {'id': id.toDart, 'emoji': emoji.toDart}}),
              onError: (Object e) => _publishState({'reactionError': e.toString()}),
            );
      }).toJS,
    );

    globalContext.setProperty(
      '__doStartTyping'.toJS,
      (() {
        // ignore: discarded_futures
        chat.startTyping(room: defaultRoom);
      }).toJS,
    );

    globalContext.setProperty(
      '__doStopTyping'.toJS,
      (() {
        // ignore: discarded_futures
        chat.stopTyping(room: defaultRoom);
      }).toJS,
    );

    globalContext.setProperty(
      '__doMarkAsRead'.toJS,
      ((JSString id) {
        // ignore: discarded_futures
        chat.markAsRead(id.toDart).then(
              (_) => _publishState({'lastMarkedRead': id.toDart}),
              onError: (Object e) => _publishState({'markReadError': e.toString()}),
            );
      }).toJS,
    );

    globalContext.setProperty(
      '__doSetPresence'.toJS,
      ((JSString status) {
        final parsed = RavenPresenceStatus.values.byName(status.toDart);
        // ignore: discarded_futures
        chat.setPresence(parsed);
      }).toJS,
    );

    globalContext.setProperty(
      '__doGetPresence'.toJS,
      (() {
        // ignore: discarded_futures
        chat.getPresence(room: defaultRoom).then(
          (list) => _publishState({
            'presenceSnapshot': list.map((p) => {'userId': p.userId, 'status': p.status.name}).toList(),
          }),
          onError: (Object e) => _publishState({'presenceError': e.toString()}),
        );
      }).toJS,
    );

    globalContext.setProperty(
      '__doDisconnect'.toJS,
      (() {
        // ignore: discarded_futures
        chat.disconnect().then((_) => _publishState({'phase': 'disconnected'}));
      }).toJS,
    );
  }

  @override
  Widget build(BuildContext context) => Text(_summary);
}
