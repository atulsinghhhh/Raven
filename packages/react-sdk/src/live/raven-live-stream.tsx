'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { joinLiveStream, type LiveStream, type LiveStreamCredentials } from '@ravenkash/client';
import { RavenStoreContext } from '../context';
import { RavenStore } from '../store';
import { RavenChatStoreContext } from '../chat/chat-context';
import { RavenChatStore } from '../chat/chat-store';
import { RavenLiveStreamContext, type RavenLiveStreamContextValue, type RavenLiveStreamStatus } from './live-context';

export interface RavenLiveStreamProps {
  /** Minted server-side by `addHost()` or `createViewerToken()`. Never build one by hand. */
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
 * Mounts the *same* `RavenStoreContext` and `RavenChatStoreContext` that
 * `<RavenRoom>` and `<RavenChat>` use, on purpose. A stream's `room` and
 * `chat` are precisely a `@ravenkash/rtc` `Room` and a `@ravenkash/chat`
 * `ChatClient`, so every existing hook already works inside a
 * `<RavenLiveStream>`: `useParticipants`, `useCamera`, `useMicrophone`,
 * `useMessages`, `useReactions`, `useTyping`, the lot. Nothing here
 * reimplements participants or chat.
 *
 * Client-only. Never render this from a Server Component.
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

  // Credentials are read once at mount, the same one-shot model
  // <RavenRoom> and <RavenChat> use. A stream credential is minted for one
  // identity and one role, so swapping it mid-flight changes who this
  // component *is*. To switch, remount with
  // <RavenLiveStream key={credentials.streamId}>.
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
      // detachExisting(), not dispose(). stream.leave() below already tears
      // down the underlying RTC and chat connections, and dispose() would
      // leave and disconnect them all over again.
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
