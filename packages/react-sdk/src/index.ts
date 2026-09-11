export { RavenRoom } from './raven-room';
export type { RavenRoomProps } from './raven-room';

export {
  useCamera,
  useCameraEffects,
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
export type { UseCameraEffectsResult, UseRavenResult } from './hooks';

// ---------------------------------------------------------------------------
// Effects (Phase 16), the @ravenkash/effects integration.
//
// useCameraEffects() above is the ergonomic entry point. These re-exports
// are so a component can build filter and preset configs, like
// `raven.effects.filters.brightness(...)`, without importing
// @ravenkash/effects directly. Same arrangement as the @ravenkash/rtc
// re-exports below.
export {
  createEffectsPipeline,
  EFFECT_SECURITY_LIMITS,
  filters as effectFilters,
  isEffectsError,
  presets as effectPresets,
} from '@ravenkash/effects';
export type {
  ColorOpParams,
  EffectInstance,
  EffectsError,
  EffectsErrorCode,
  EffectsPipeline,
  FilterConfig,
  Preset,
} from '@ravenkash/effects';

export { LocalParticipantView, ParticipantView, RavenAudio, RavenVideo } from './components';
export type { ParticipantViewProps, RavenAudioProps, RavenVideoProps } from './components';

export type { RavenConnectionState, RavenSnapshot } from './store';

// Re-exported for convenience, so anyone building on @ravenkash/react
// doesn't need a direct @ravenkash/rtc import just to name a common type.
//
// No media-plane type is ever re-exported (Phase 11 spec §27). Everything
// here is Livqeno's own vocabulary, which is exactly what let the SFU
// underneath get replaced without touching this file.
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
} from '@ravenkash/rtc';
export { isRTCError } from '@ravenkash/rtc';

// ---------------------------------------------------------------------------
// Chat (Phase 12), the @ravenkash/chat integration.
//
// Its own provider and its own hooks, but sharing this package's existing
// store/snapshot pattern instead of inventing a second one (spec §43).
// RTC and Chat stay independent: use either alone, or mount both together
// for a call with a chat panel.
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

// Re-exported for convenience, same as the RTC types above, so a chat UI
// doesn't need a direct @ravenkash/chat import for common types.
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
} from '@ravenkash/chat';
export { isRavenChatError, RavenChatError } from '@ravenkash/chat';

// ---------------------------------------------------------------------------
// Live Streaming (Phase 14), the @ravenkash/client integration.
//
// A stream's room and chat are an ordinary Room and ChatClient, so
// useParticipants, useCamera and useMicrophone from above, plus
// useMessages, useReactions, useTyping and the rest of the chat hooks, all
// already work inside <RavenLiveStream>. src/live/live-hooks.ts explains
// why there's no separate useLiveStreamParticipants() or
// useLiveStreamChat().
// ---------------------------------------------------------------------------
export { RavenLiveStream } from './live/raven-live-stream';
export type { RavenLiveStreamProps } from './live/raven-live-stream';

export {
  useLiveStream,
  useLiveStreamClient,
  useLiveStreamHost,
  useLiveStreamRole,
  useLiveStreamViewer,
} from './live/live-hooks';
export type { UseLiveStreamHostResult, UseLiveStreamResult } from './live/live-hooks';

export type { RavenLiveStreamContextValue, RavenLiveStreamStatus } from './live/live-context';

// Re-exported for convenience, same as the RTC and Chat types above, so a
// live-streaming UI doesn't need a direct @ravenkash/client import for
// common types. @ravenkash/client's own discipline carries over unchanged:
// nothing transport- or media-plane-specific ever reaches this surface.
export type { LiveStream, LiveStreamCredentials, LiveStreamRole } from '@ravenkash/client';
