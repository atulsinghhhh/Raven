export { RavenRoom } from './raven-room';
export type { RavenRoomProps } from './raven-room';

export {
  useCamera,
  useConnectionState,
  useLocalParticipant,
  useMicrophone,
  useParticipants,
  useRaven,
  useRavenClient,
  useRavenError,
  useRemoteParticipants,
  useRoom,
} from './hooks';
export type { UseRavenResult } from './hooks';

export { LocalParticipantView, ParticipantView, RavenAudio, RavenVideo } from './components';
export type { ParticipantViewProps, RavenAudioProps, RavenVideoProps } from './components';

export type { RavenConnectionState, RavenSnapshot } from './store';

// Re-exported for convenience so a developer building with @corvidhq/react
// doesn't also need a direct @corvidhq/rtc import for common types —
// LiveKit itself is still never re-exported (Phase 11 spec §27).
export type {
  ConnectionState,
  DeviceInfo,
  DeviceKind,
  LocalParticipant,
  LocalTrack,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  Room,
  RTCClientConfig,
  RTCError,
  RTCErrorCode,
  Track,
  TrackKind,
} from '@corvidhq/rtc';
export { isRTCError } from '@corvidhq/rtc';

// ---------------------------------------------------------------------------
// Chat (Phase 12) — @corvidhq/chat integration.
//
// A separate provider and a separate set of hooks, sharing this package's
// existing store/snapshot pattern rather than introducing a second one
// (spec §43). RTC and Chat stay independent: either can be used alone,
// and both can be mounted together for a call with a chat panel.
// ---------------------------------------------------------------------------
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

// Re-exported for convenience, same as the RTC types above — so a chat UI
// doesn't need a direct @corvidhq/chat import for common types.
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
