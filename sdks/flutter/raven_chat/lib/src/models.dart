/// Message kinds Livqeno understands. `unknown` exists so a newer server
/// sending a type this version predates widens the model instead of
/// throwing on an app the developer didn't change.
enum RavenMessageType { text, system, event, attachment, unknown }

enum RavenPresenceStatus { online, away, offline }

/// Connection lifecycle, matching `@raven/chat`'s vocabulary exactly.
///
/// `failed` is terminal: reconnect attempts are exhausted, or the
/// failure is one retrying cannot fix, like a revoked token.
/// `disconnected` means the connection ended and nothing is being
/// retried.
enum RavenChatConnectionState {
  idle,
  connecting,
  connected,
  reconnecting,
  disconnected,
  failed,
}

/// A reaction, already grouped per emoji.
///
/// Grouping happens server-side so every client renders "👍 ×3" the same
/// way instead of each one regrouping raw rows.
class RavenReaction {
  const RavenReaction({
    required this.emoji,
    required this.count,
    required this.userIds,
  });

  factory RavenReaction.fromJson(Map<String, dynamic> json) => RavenReaction(
        emoji: json['emoji'] as String? ?? '',
        count: (json['count'] as num?)?.toInt() ?? 0,
        userIds: (json['userIds'] as List<dynamic>? ?? const [])
            .map((value) => value as String)
            .toList(growable: false),
      );

  final String emoji;
  final int count;

  /// Who reacted. Lets a UI show "you reacted" and a hover list without a
  /// second request.
  final List<String> userIds;
}

/// File metadata attached to a message. The bytes live in object storage
/// and are reached through a short-lived signed URL, never through this
/// object.
class RavenAttachment {
  const RavenAttachment({
    required this.id,
    required this.filename,
    required this.mimeType,
    required this.size,
    required this.status,
  });

  factory RavenAttachment.fromJson(Map<String, dynamic> json) =>
      RavenAttachment(
        id: json['id'] as String,
        filename: json['filename'] as String? ?? 'file',
        mimeType: json['mimeType'] as String? ?? 'application/octet-stream',
        size: (json['size'] as num?)?.toInt() ?? 0,
        status: json['status'] as String? ?? 'pending',
      );

  final String id;
  final String filename;
  final String mimeType;
  final int size;
  final String status;
}

/// A message, exactly as the server stored it.
///
/// [id] and [createdAt] are always the server's: the SDK never invents
/// either, which is what keeps ordering consistent across every client in
/// a room.
class RavenMessage {
  const RavenMessage({
    required this.id,
    required this.roomId,
    required this.senderId,
    required this.type,
    required this.text,
    required this.createdAt,
    this.replyTo,
    this.threadRootId,
    this.clientMessageId,
    this.metadata,
    this.attachment,
    this.reactions = const [],
    this.edited = false,
    this.deleted = false,
    this.editedAt,
    this.deletedAt,
  });

  factory RavenMessage.fromJson(Map<String, dynamic> json) => RavenMessage(
        id: json['id'] as String,
        roomId: json['roomId'] as String? ?? '',
        senderId: json['senderId'] as String? ?? '',
        type: _parseType(json['type'] as String?),
        // Null for a deleted message: the server withholds the body
        // rather than sending it with a flag, so it can't be recovered
        // from the payload.
        text: json['text'] as String?,
        replyTo: json['replyTo'] as String?,
        threadRootId: json['threadRootId'] as String?,
        clientMessageId: json['clientMessageId'] as String?,
        metadata: json['metadata'] as Map<String, dynamic>?,
        attachment: json['attachment'] == null
            ? null
            : RavenAttachment.fromJson(
                json['attachment'] as Map<String, dynamic>),
        reactions: (json['reactions'] as List<dynamic>? ?? const [])
            .map((value) =>
                RavenReaction.fromJson(value as Map<String, dynamic>))
            .toList(growable: false),
        edited: json['edited'] as bool? ?? false,
        deleted: json['deleted'] as bool? ?? false,
        createdAt: DateTime.parse(json['createdAt'] as String),
        editedAt: _parseDate(json['editedAt']),
        deletedAt: _parseDate(json['deletedAt']),
      );

  /// Livqeno's canonical `msg_…` id.
  final String id;

  /// The conversation's public id: the same string passed to `connect`.
  final String roomId;
  final String senderId;
  final RavenMessageType type;

  /// Null for messages with no text, and for deleted ones.
  final String? text;

  /// The message this replies to, if any.
  final String? replyTo;

  /// The thread this belongs to. Equals the root message's id.
  final String? threadRootId;

  /// Whatever was passed as an idempotency key, echoed back.
  final String? clientMessageId;
  final Map<String, dynamic>? metadata;
  final RavenAttachment? attachment;
  final List<RavenReaction> reactions;
  final bool edited;
  final bool deleted;
  final DateTime createdAt;
  final DateTime? editedAt;
  final DateTime? deletedAt;

  /// A copy with the given fields replaced. Used by the store to fold an
  /// edit or a deletion into an existing list without rebuilding it.
  RavenMessage copyWith({
    String? text,
    bool? edited,
    bool? deleted,
    DateTime? editedAt,
    DateTime? deletedAt,
    List<RavenReaction>? reactions,
  }) =>
      RavenMessage(
        id: id,
        roomId: roomId,
        senderId: senderId,
        type: type,
        text: text ?? this.text,
        replyTo: replyTo,
        threadRootId: threadRootId,
        clientMessageId: clientMessageId,
        metadata: metadata,
        attachment: attachment,
        reactions: reactions ?? this.reactions,
        edited: edited ?? this.edited,
        deleted: deleted ?? this.deleted,
        createdAt: createdAt,
        editedAt: editedAt ?? this.editedAt,
        deletedAt: deletedAt ?? this.deletedAt,
      );

  @override
  bool operator ==(Object other) => other is RavenMessage && other.id == id;

  @override
  int get hashCode => id.hashCode;
}

/// One page of history.
///
/// Pagination is cursor-based, never offset-based: pass [nextCursor] as
/// `before` to walk back through history, or [previousCursor] as `after`
/// to catch up on what arrived while disconnected.
class RavenMessagePage {
  const RavenMessagePage({
    required this.messages,
    this.nextCursor,
    this.previousCursor,
    this.hasMore = false,
  });

  factory RavenMessagePage.fromJson(Map<String, dynamic> json) =>
      RavenMessagePage(
        messages: (json['data'] as List<dynamic>? ?? const [])
            .map(
                (value) => RavenMessage.fromJson(value as Map<String, dynamic>))
            .toList(growable: false),
        nextCursor: json['nextCursor'] as String?,
        previousCursor: json['previousCursor'] as String?,
        hasMore: json['hasMore'] as bool? ?? false,
      );

  final List<RavenMessage> messages;
  final String? nextCursor;
  final String? previousCursor;
  final bool hasMore;
}

/// Someone's presence in a conversation. Ephemeral by design: this is
/// never read from durable storage.
class RavenPresence {
  const RavenPresence({required this.userId, required this.status});

  factory RavenPresence.fromJson(Map<String, dynamic> json) => RavenPresence(
        userId: json['userId'] as String,
        status: _parsePresence(json['status'] as String?),
      );

  final String userId;
  final RavenPresenceStatus status;
}

/// A user's read position in a conversation.
class RavenReadState {
  const RavenReadState({
    required this.roomId,
    required this.userId,
    required this.lastReadMessageId,
    required this.unreadCount,
  });

  factory RavenReadState.fromJson(Map<String, dynamic> json) => RavenReadState(
        roomId: json['roomId'] as String? ?? '',
        userId: json['userId'] as String? ?? '',
        lastReadMessageId: json['lastReadMessageId'] as String?,
        unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
      );

  final String roomId;
  final String userId;
  final String? lastReadMessageId;
  final int unreadCount;
}

/// Someone started or stopped typing.
class RavenTypingEvent {
  const RavenTypingEvent({
    required this.roomId,
    required this.userId,
    required this.isTyping,
  });

  final String roomId;
  final String userId;
  final bool isTyping;
}

/// A reaction was added or removed.
class RavenReactionEvent {
  const RavenReactionEvent({
    required this.messageId,
    required this.roomId,
    required this.userId,
    required this.emoji,
    required this.added,
  });

  final String messageId;
  final String roomId;
  final String userId;
  final String emoji;
  final bool added;
}

RavenMessageType _parseType(String? value) {
  switch (value) {
    case 'text':
      return RavenMessageType.text;
    case 'system':
      return RavenMessageType.system;
    case 'event':
      return RavenMessageType.event;
    case 'attachment':
      return RavenMessageType.attachment;
    default:
      return RavenMessageType.unknown;
  }
}

RavenPresenceStatus _parsePresence(String? value) {
  switch (value) {
    case 'online':
      return RavenPresenceStatus.online;
    case 'away':
      return RavenPresenceStatus.away;
    default:
      return RavenPresenceStatus.offline;
  }
}

DateTime? _parseDate(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;
