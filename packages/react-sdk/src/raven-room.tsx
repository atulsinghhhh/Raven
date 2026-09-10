'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { RTCClientConfig, RTCError } from '@ravenkash/rtc';
import { RavenStoreContext } from './context';
import { RavenStore } from './store';

export interface RavenRoomProps extends RTCClientConfig {
  /** The room to join. Required whenever `autoConnect` (the default) is true. */
  room: string;
  /**
   * Defaults to `true`: joins on mount, leaves on unmount. Set `false` to
   * drive `join()` and `leave()` yourself through `useRaven()`, say to join
   * only once the user clicks something.
   */
  autoConnect?: boolean;
  /** Rendered instead of `children` while the initial join is in flight, or if it fails. */
  fallback?: ReactNode;
  onError?: (error: RTCError) => void;
  children?: ReactNode;
}

/**
 * The provider every `@ravenkash/react` hook and component needs. Also
 * usable directly as the "RavenRoom" primitive from the Phase 11 spec.
 *
 * Owns exactly one `RTCClient` and `Room` for its whole lifetime, and
 * unmounting it always calls `leave()`. So tearing down a video call UI is
 * just a matter of unmounting this component.
 *
 * Client-only. Never render it from a Server Component (see
 * docs/sdk/react.md#nextjs).
 */
export function RavenRoom({
  room: roomId,
  autoConnect = true,
  fallback,
  onError,
  children,
  ...config
}: RavenRoomProps) {
  const storeRef = useRef<RavenStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new RavenStore();
    storeRef.current.init(config);
  }
  const store = storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // `room`, token and the rest are read once at mount and pointedly not
  // re-applied on change. An RTC token is minted for exactly one join, the
  // same one-shot model @ravenkash/rtc itself uses. To swap the token,
  // remount <RavenRoom key={token}> with a fresh one.
  useEffect(() => {
    if (!autoConnect) return undefined;

    store.join(roomId).catch((error: unknown) => {
      onError?.(error as RTCError);
    });

    return () => {
      store.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  const isConnectingOrFailed =
    autoConnect &&
    (snapshot.connectionState === 'idle' ||
      snapshot.connectionState === 'connecting' ||
      snapshot.connectionState === 'failed');

  return (
    <RavenStoreContext.Provider value={store}>
      {isConnectingOrFailed ? (fallback ?? null) : children}
    </RavenStoreContext.Provider>
  );
}
