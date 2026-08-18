'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { RTCClientConfig, RTCError } from '@raven/rtc';
import { RavenStoreContext } from './context';
import { RavenStore } from './store';

export interface RavenRoomProps extends RTCClientConfig {
  /** The room to join. Required whenever `autoConnect` (the default) is true. */
  room: string;
  /**
   * Defaults to `true` — joins automatically on mount and leaves on
   * unmount. Set `false` to drive `join()`/`leave()` yourself via
   * `useRaven()` (e.g. to join only after the user clicks a button).
   */
  autoConnect?: boolean;
  /** Rendered instead of `children` while the initial join is in flight, or if it fails. */
  fallback?: ReactNode;
  onError?: (error: RTCError) => void;
  children?: ReactNode;
}

/**
 * The provider every `@raven/react` hook and component needs — also
 * usable directly as the "RavenRoom" primitive from the Phase 11 spec.
 * Owns exactly one `RTCClient`/`Room` for its lifetime; unmounting it
 * always calls `leave()`, so a video call UI can be torn down just by
 * unmounting this component.
 *
 * Client-only — never render this from a Server Component (see
 * docs/sdk/react.md#nextjs).
 */
export function RavenRoom({ room: roomId, autoConnect = true, fallback, onError, children, ...config }: RavenRoomProps) {
  const storeRef = useRef<RavenStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new RavenStore();
    storeRef.current.init(config);
  }
  const store = storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // `room`/token/etc. are read once at mount and intentionally not
  // re-applied on change — an RTC token is minted for exactly one join,
  // the same one-shot model @raven/rtc itself uses. Swap the token by
  // remounting <RavenRoom key={token}> with a fresh one.
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

  const isConnectingOrFailed = autoConnect && (snapshot.connectionState === 'idle' || snapshot.connectionState === 'connecting' || snapshot.connectionState === 'failed');

  return (
    <RavenStoreContext.Provider value={store}>
      {isConnectingOrFailed ? (fallback ?? null) : children}
    </RavenStoreContext.Provider>
  );
}
