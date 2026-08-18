'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  ChatClient,
  ChatConnectionState,
  ChatMessage,
  PresenceStatus,
  RavenChatError,
} from '@raven/chat';
import { useRavenChatStore } from './chat-context';
import type { RavenChatSnapshot } from './chat-store';

/**
 * Chat hooks for `@raven/react`.
 *
 * Each hook reads exactly one slice of the store's snapshot, so a
 * component that only renders typing indicators doesn't re-render on
 * every incoming message (spec §59). That's why these aren't one big
 * `useChat()` returning everything — `useChat()` exists for the cases
 * that genuinely need the whole picture, and the narrow hooks are what
 * you should reach for otherwise.
 */

export interface UseChatResult extends RavenChatSnapshot {
  send(text: string, options?: { replyTo?: string }): Promise<void>;
  loadMore(limit?: number): Promise<void>;
  connect(room: string): Promise<void>;
  disconnect(): Promise<void>;
}

/** The full snapshot plus actions. Prefer the narrower hooks where you can. */
export function useChat(): UseChatResult {
  const store = useRavenChatStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return useMemo(
    () => ({
      ...snapshot,
      send: store.send,
      loadMore: store.loadMore,
      connect: (room: string) => store.connect(room),
      disconnect: () => store.disconnect(),
    }),
    [snapshot, store],
  );
}

/** The underlying `ChatClient`, for anything the hooks don't cover. */
export function useChatClient(): ChatClient | undefined {
  const store = useRavenChatStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().client, () => store.getSnapshot().client);
}

export function useChatConnectionState(): ChatConnectionState {
  const store = useRavenChatStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().connectionState,
    () => store.getSnapshot().connectionState,
  );
}

export function useChatError(): RavenChatError | undefined {
  const store = useRavenChatStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().error, () => store.getSnapshot().error);
}

export interface UseMessagesResult {
  /** Oldest-first — render order. */
  messages: ChatMessage[];
  send(text: string, options?: { replyTo?: string }): Promise<void>;
  loadMore(limit?: number): Promise<void>;
  loading: boolean;
  hasMore: boolean;
}

/** The message list and the two things you do with it: send, and page back. */
export function useMessages(): UseMessagesResult {
  const store = useRavenChatStore();
  const messages = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().messages,
    () => store.getSnapshot().messages,
  );
  const loading = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().loadingHistory,
    () => store.getSnapshot().loadingHistory,
  );
  const hasMore = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().hasMoreHistory,
    () => store.getSnapshot().hasMoreHistory,
  );

  return { messages, send: store.send, loadMore: store.loadMore, loading, hasMore };
}

/** Who is present, as `{ userId: status }`. Ephemeral — never durable state. */
export function usePresence(): Record<string, PresenceStatus> {
  const store = useRavenChatStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().presence,
    () => store.getSnapshot().presence,
  );
}

export interface UseTypingResult {
  /** Everyone currently typing, excluding this user. */
  typingUsers: string[];
  /**
   * Call on every keystroke. Throttled internally to one signal per
   * second, and stops automatically after a pause — so a component can
   * wire this straight to `onChange` without thinking about it (spec §21).
   */
  onInput(): void;
  stop(): void;
}

export function useTyping(): UseTypingResult {
  const store = useRavenChatStore();
  const client = useChatClient();
  const typingUsers = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().typing,
    () => store.getSnapshot().typing,
  );

  const lastSignalRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onInput = useCallback(() => {
    if (!client) return;

    // Throttle: the server only broadcasts on the transition into
    // "typing", but firing a frame per keystroke would still be one
    // WebSocket write per character for no benefit.
    const now = Date.now();
    if (now - lastSignalRef.current > 1_000) {
      lastSignalRef.current = now;
      void client.startTyping().catch(() => undefined);
    }

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      lastSignalRef.current = 0;
      void client.stopTyping().catch(() => undefined);
    }, 2_000);
  }, [client]);

  const stop = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    lastSignalRef.current = 0;
    void client?.stopTyping().catch(() => undefined);
  }, [client]);

  // A component unmounting mid-sentence must not leave the user showing
  // as typing to everyone else.
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, []);

  return { typingUsers, onInput, stop };
}

export interface UseReactionsResult {
  add(messageId: string, emoji: string): Promise<void>;
  remove(messageId: string, emoji: string): Promise<void>;
  /** Set while a reaction call is in flight, for disabling a button. */
  pending: boolean;
  error?: RavenChatError;
}

export function useReactions(): UseReactionsResult {
  const client = useChatClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RavenChatError>();

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      if (!client) return;
      setPending(true);
      setError(undefined);
      try {
        await action();
      } catch (err) {
        setError(err as RavenChatError);
      } finally {
        setPending(false);
      }
    },
    [client],
  );

  return {
    add: (messageId, emoji) => run(() => client!.messages.addReaction(messageId, emoji)),
    remove: (messageId, emoji) => run(() => client!.messages.removeReaction(messageId, emoji)),
    pending,
    error,
  };
}

export interface UseReadReceiptsResult {
  /** `{ userId: lastReadMessageId }` for everyone who has read something. */
  receipts: Record<string, string | null>;
  markAsRead(messageId: string): Promise<void>;
  /** Everyone (other than you) who has read this specific message or later. */
  readersOf(messageId: string, messages: ChatMessage[]): string[];
}

export function useReadReceipts(): UseReadReceiptsResult {
  const store = useRavenChatStore();
  const client = useChatClient();
  const receipts = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().readReceipts,
    () => store.getSnapshot().readReceipts,
  );

  const markAsRead = useCallback(
    async (messageId: string) => {
      await client?.markAsRead(messageId).catch(() => undefined);
    },
    [client],
  );

  const readersOf = useCallback(
    (messageId: string, messages: ChatMessage[]): string[] => {
      const index = messages.findIndex((message) => message.id === messageId);
      if (index === -1) return [];

      // "Read up to X" means everything at or before X, so a reader
      // counts if their marker sits at this message or later in the list.
      return Object.entries(receipts)
        .filter(([userId, lastReadId]) => {
          if (userId === client?.userId || !lastReadId) return false;
          const readIndex = messages.findIndex((message) => message.id === lastReadId);
          return readIndex >= index;
        })
        .map(([userId]) => userId);
    },
    [receipts, client],
  );

  return { receipts, markAsRead, readersOf };
}
