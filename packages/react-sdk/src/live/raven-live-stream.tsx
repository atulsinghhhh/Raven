'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { joinLiveStream, type LiveStream, type LiveStreamCredentials } from '@corvidhq/client';
import { RavenStoreContext } from '../context';
import { RavenStore } from '../store';
import { RavenChatStoreContext } from '../chat/chat-context';
import { RavenChatStore } from '../chat/chat-store';
import { RavenLiveStreamContext, type RavenLiveStreamContextValue, type RavenLiveStreamStatus } from './live-context';

export interface RavenLiveStreamProps {
  /** Minted server-side by `addHost()`/`createViewerToken()` — never construct this by hand. */
  credentials: LiveStreamCredentials;
  /** How many messages of live chat history to load once connected. Defaults to 50. */
  historyLimit?: number;
  /** Rendered instead of `children` while connecting, or if the connection failed. */
  fallback?: ReactNode;
  onError?: (error: unknown) => void;
  children?: ReactNode;
}

/**
 * The provider every Live Streaming hook needs.
 *
 * Deliberately mounts the *same* `RavenStoreContext`/`RavenChatStoreContext`
 * that `<RavenRoom>`/`<RavenChat>` use — a stream's `room` and `chat` are
 * exactly a `@corvidhq/rtc` `Room` and a `@corvidhq/chat` `ChatClient`, so
 * every existing hook (`useParticipants`, `useCamera`, `useMicrophone`,
 * `useMessages`, `useReactions`, `useTyping`, ...) already works inside a
 * `<RavenLiveStream>` — nothing here reimplements participants or chat.
 *
 * Client-only — never render this from a Server Component.
 */
export function RavenLiveStream({ credentials, historyLimit = 50, fallback, onError, children }: RavenLiveStreamProps) {
  const rtcStoreRef = useRef<RavenStore | null>(null);
  const chatStoreRef = useRef<RavenChatStore | null>(null);
  if (!rtcStoreRef.current) rtcStoreRef.current = new RavenStore();
  if (!chatStoreRef.current) chatStoreRef.current = new RavenChatStore();
  const streamRef = useRef<LiveStream | undefined>(undefined);

  const [state, setState] = useState<{ status: RavenLiveStreamStatus; stream?: LiveStream; error?: unknown }>({
    status: 'connecting',
  });

  // Credentials are read once at mount, same one-shot model as
  // <RavenRoom>/<RavenChat> — a stream credential is minted for one
  // identity and one role; swapping it mid-flight would change who this
  // component *is*. Remount with <RavenLiveStream key={credentials.streamId}> to switch.
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'connecting' });

    joinLiveStream(credentials)
      .then(async (stream) => {
        if (cancelled) {
          void stream.leave();
          return;
        }
        streamRef.current = stream;
        rtcStoreRef.current!.attachExisting(stream.room, stream.rtc);
        if (stream.chat && credentials.chat) {
          await chatStoreRef.current!.attachExisting(stream.chat, credentials.chat.conversations[0], historyLimit);
        }
        if (cancelled) return;
        setState({ status: 'ready', stream });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'failed', error });
        onError?.(error);
      });

    return () => {
      cancelled = true;
      // detachExisting(), not dispose() — stream.leave() below already
      // tears down the underlying RTC/chat connections; dispose() would
      // leave/disconnect them a second time.
      rtcStoreRef.current?.detachExisting();
      chatStoreRef.current?.detachExisting();
      void streamRef.current?.leave();
      streamRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials.streamId]);

  const contextValue: RavenLiveStreamContextValue = useMemo(
    () => ({
      status: state.status,
      streamId: credentials.streamId,
      role: credentials.role,
      isHost: credentials.role === 'HOST' || credentials.role === 'CO_HOST',
      stream: state.stream,
      error: state.error,
      leave: async () => {
        await streamRef.current?.leave();
      },
      react: async (emoji: string) => {
        if (!streamRef.current) return;
        await streamRef.current.react(emoji);
      },
    }),
    [state, credentials.streamId, credentials.role],
  );

  const notReady = state.status !== 'ready';

  return (
    <RavenLiveStreamContext.Provider value={contextValue}>
      <RavenStoreContext.Provider value={rtcStoreRef.current}>
        <RavenChatStoreContext.Provider value={chatStoreRef.current}>
          {notReady ? (fallback ?? null) : children}
        </RavenChatStoreContext.Provider>
      </RavenStoreContext.Provider>
    </RavenLiveStreamContext.Provider>
  );
}
