// Chat-only entry point (`@corvidhq/react/chat`).
//
// `src/chat/*` depends on nothing but `react` and `@corvidhq/chat` — no
// coupling to RTC/effects/live. This file exists so a consumer that only
// wants Chat (e.g. a text-channel feature with no video/voice) never needs
// `@corvidhq/rtc`/`@corvidhq/effects`/`@corvidhq/client` resolvable, honoring
// what `package.json`'s `peerDependenciesMeta` already promises — the single
// `index.ts` barrel re-exports from all four integrations unconditionally,
// so bundlers require every peer to be installed just to import anything
// from it at all. Keep this file's re-exports in sync with index.ts's Chat
// section if that ever changes.
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
