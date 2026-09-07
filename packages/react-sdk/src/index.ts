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
// Effects (Phase 16) — @corvidhq/effects integration. useCameraEffects()
// above is the ergonomic entry point; these re-exports let a component
// build filter/preset configs (`raven.effects.filters.brightness(...)`)
// without a direct @corvidhq/effects import, mirroring the @corvidhq/rtc
// re-exports below.
export {
  createEffectsPipeline,
  EFFECT_SECURITY_LIMITS,
  filters as effectFilters,
  isEffectsError,
  presets as effectPresets,
} from '@corvidhq/effects';
export type {
  ColorOpParams,
  EffectInstance,
  EffectsError,
  EffectsErrorCode,
  EffectsPipeline,
  FilterConfig,
  Preset,
} from '@corvidhq/effects';

export { LocalParticipantView, ParticipantView, RavenAudio, RavenVideo } from './components';
export type { ParticipantViewProps, RavenAudioProps, RavenVideoProps } from './components';

export type { RavenConnectionState, RavenSnapshot } from './store';

// Re-exported for convenience so a developer building with @corvidhq/react
// doesn't also need a direct @corvidhq/rtc import for common types. No
// media-plane type is ever re-exported (Phase 11 spec §27) — the surface
// here is Raven's own vocabulary, which is what let the SFU underneath it
// be replaced without touching this file.
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

// ---------------------------------------------------------------------------
// Live Streaming (Phase 14) — @corvidhq/client integration.
//
// A stream's room and chat are an ordinary Room and ChatClient, so
// useParticipants/useCamera/useMicrophone (above) and
// useMessages/useReactions/useTyping/etc. (chat, above) already work
// inside <RavenLiveStream> — see src/live/live-hooks.ts for why there is
// no separate useLiveStreamParticipants()/useLiveStreamChat().
// ---------------------------------------------------------------------------
export { RavenLiveStream } from './live/raven-live-stream';
export type { RavenLiveStreamProps } from './live/raven-live-stream';

export { useLiveStream, useLiveStreamClient, useLiveStreamHost, useLiveStreamRole, useLiveStreamViewer } from './live/live-hooks';
export type { UseLiveStreamHostResult, UseLiveStreamResult } from './live/live-hooks';

export type { RavenLiveStreamContextValue, RavenLiveStreamStatus } from './live/live-context';

// Re-exported for convenience, same as the RTC/Chat types above — so a
// live-streaming UI doesn't need a direct @corvidhq/client import for
// common types. @corvidhq/client's own discipline applies here unchanged:
// nothing transport- or media-plane-specific ever reaches this surface.
export type { LiveStream, LiveStreamCredentials, LiveStreamRole } from '@corvidhq/client';
