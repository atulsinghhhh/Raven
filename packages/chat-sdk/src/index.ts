export { ChatClient, createChatClient } from './client';
export type { ChatEventMap, ConnectOptions } from './client';

export { MessagesApi } from './messages-api';
export { AttachmentsApi } from './attachments-api';
export type { AttachmentUploadTicket } from './attachments-api';

export type { ChatClientConfig } from './config';

export type {
  ChatAttachment,
  ChatConnectionState,
  ChatMessage,
  ChatMessageType,
  ChatReaction,
  ListMessagesOptions,
  MessageDeletedEvent,
  MessagePage,
  PresenceEvent,
  PresenceStatus,
  ReactionEvent,
  ReadReceiptEvent,
  ReadState,
  SendMessageOptions,
  SendMessageResult,
  TypingEvent,
} from './types';

export {
  RavenAttachmentError,
  RavenChatAuthenticationError,
  RavenChatConnectionError,
  RavenChatError,
  RavenChatPermissionError,
  RavenMessageError,
  RavenRateLimitError,
  RavenRoomError,
  isRavenChatError,
} from './errors';
export type { ChatErrorCode } from './errors';

export type { Unsubscribe } from './events';
export type { LogLevel } from './logger';
export { CHAT_SDK_VERSION } from './version';

// Deliberately not exported: SocketTransport, RestClient, the frame
// vocabulary, and every other internal. A developer using @raven/chat
// should never need to know a WebSocket is involved (spec §57).
