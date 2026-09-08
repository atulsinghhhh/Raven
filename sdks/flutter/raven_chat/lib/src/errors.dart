/// Stable error codes, identical to `@raven/chat`'s on the web.
///
/// A team shipping web and Flutter should be reading one vocabulary, and
/// a support conversation shouldn't depend on which platform the user was
/// on. `unknown` is the deliberate escape hatch: a code this version
/// predates becomes `unknown` with the original string preserved on
/// [RavenChatException.rawCode], rather than crashing an app that a
/// server upgrade moved underneath.
enum RavenChatErrorCode {
  invalidToken,
  tokenExpired,
  tokenRevoked,
  unauthorized,
  permissionDenied,
  notAMember,
  roomNotFound,
  notInRoom,
  conversationArchived,
  messageNotFound,
  messageDeleted,
  messageTooLarge,
  invalidMessage,
  invalidCursor,
  rateLimited,
  attachmentNotFound,
  connectionFailed,
  connectionClosed,
  networkError,
  timeout,
  internalError,
  unknown,
}

/// The one error type this package throws.
///
/// Never a raw `WebSocketException`, a `SocketException`, or an HTTP
/// status: those are infrastructure Raven is meant to be hiding.
class RavenChatException implements Exception {
  const RavenChatException(
    this.code,
    this.message, {
    this.rawCode,
    this.retryAfterSeconds,
    this.cause,
  });

  /// Builds one from a server error payload.
  factory RavenChatException.fromServer(Map<String, dynamic> json) {
    final raw = json['code'] as String?;
    return RavenChatException(
      parseChatErrorCode(raw),
      json['message'] as String? ?? 'The chat request failed.',
      rawCode: raw,
      retryAfterSeconds: (json['retryAfterSeconds'] as num?)?.toInt(),
    );
  }

  final RavenChatErrorCode code;
  final String message;

  /// The server's original code string. Set when [code] is
  /// [RavenChatErrorCode.unknown], so a developer can still see what
  /// arrived.
  final String? rawCode;

  /// Only set on [RavenChatErrorCode.rateLimited]: how long to wait.
  final int? retryAfterSeconds;

  final Object? cause;

  /// True when retrying could plausibly succeed. A rejected token or a
  /// message that's too large will fail identically forever.
  bool get isRetryable =>
      code == RavenChatErrorCode.networkError ||
      code == RavenChatErrorCode.timeout ||
      code == RavenChatErrorCode.connectionClosed ||
      code == RavenChatErrorCode.rateLimited ||
      code == RavenChatErrorCode.internalError;

  @override
  String toString() => 'RavenChatException(${rawCode ?? code.name}): $message';
}

/// Maps a server code string onto the enum.
RavenChatErrorCode parseChatErrorCode(String? raw) {
  switch (raw) {
    case 'INVALID_TOKEN':
      return RavenChatErrorCode.invalidToken;
    case 'TOKEN_EXPIRED':
      return RavenChatErrorCode.tokenExpired;
    case 'TOKEN_REVOKED':
      return RavenChatErrorCode.tokenRevoked;
    case 'UNAUTHORIZED':
      return RavenChatErrorCode.unauthorized;
    case 'PERMISSION_DENIED':
      return RavenChatErrorCode.permissionDenied;
    case 'NOT_A_MEMBER':
      return RavenChatErrorCode.notAMember;
    case 'ROOM_NOT_FOUND':
      return RavenChatErrorCode.roomNotFound;
    case 'NOT_IN_ROOM':
      return RavenChatErrorCode.notInRoom;
    case 'CONVERSATION_ARCHIVED':
      return RavenChatErrorCode.conversationArchived;
    case 'MESSAGE_NOT_FOUND':
      return RavenChatErrorCode.messageNotFound;
    case 'MESSAGE_DELETED':
      return RavenChatErrorCode.messageDeleted;
    case 'MESSAGE_TOO_LARGE':
      return RavenChatErrorCode.messageTooLarge;
    case 'INVALID_MESSAGE':
    case 'INVALID_MESSAGE_TYPE':
      return RavenChatErrorCode.invalidMessage;
    case 'INVALID_CURSOR':
      return RavenChatErrorCode.invalidCursor;
    case 'RATE_LIMITED':
      return RavenChatErrorCode.rateLimited;
    case 'ATTACHMENT_NOT_FOUND':
    case 'ATTACHMENTS_NOT_CONFIGURED':
    case 'ATTACHMENT_TOO_LARGE':
      return RavenChatErrorCode.attachmentNotFound;
    case 'CONNECTION_FAILED':
      return RavenChatErrorCode.connectionFailed;
    case 'CONNECTION_CLOSED':
      return RavenChatErrorCode.connectionClosed;
    case 'NETWORK_ERROR':
      return RavenChatErrorCode.networkError;
    case 'TIMEOUT':
      return RavenChatErrorCode.timeout;
    case 'INTERNAL_ERROR':
      return RavenChatErrorCode.internalError;
    default:
      return RavenChatErrorCode.unknown;
  }
}
