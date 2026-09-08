// Chat-only entry point (`@corvidhq/react/chat`).
//
// `src/chat/*` depends on `react` and `@corvidhq/chat` and nothing else. No
// coupling to RTC, effects or live.
//
// This file exists so anyone who only wants Chat, a text-channel feature
// with no video or voice say, never needs `@corvidhq/rtc`,
// `@corvidhq/effects` or `@corvidhq/client` to be resolvable. That's what
// `package.json`'s `peerDependenciesMeta` already promises, and the single
// `index.ts` barrel breaks it: it re-exports from all four integrations
// unconditionally, so a bundler demands every peer be installed just to
// import anything from it.
//
// If that ever changes, keep this file's re-exports in sync with index.ts's
// Chat section.
export { RavenChat } from './chat/raven-chat';
export type { RavenChatProps } from './chat/raven-chat';

export {
  useChat,
  useChatClient,
  useChatConnectionState,
  useChatError,
  useMessages,
  usePresence,
  useReactions,
  useReadReceipts,
  useTyping,
} from './chat/chat-hooks';
export type {
  UseChatResult,
  UseMessagesResult,
  UseReactionsResult,
  UseReadReceiptsResult,
  UseTypingResult,
} from './chat/chat-hooks';

export type { RavenChatSnapshot } from './chat/chat-store';

export type {
  ChatAttachment,
  ChatClientConfig,
  ChatConnectionState,
  ChatMessage,
  ChatMessageType,
  ChatReaction,
  MessagePage,
  PresenceStatus,
  ReadState,
  SendMessageOptions,
} from '@corvidhq/chat';
export { isRavenChatError, RavenChatError } from '@corvidhq/chat';
