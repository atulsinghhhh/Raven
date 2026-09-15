'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useDashboardRealtime } from './use-dashboard-realtime';
import {
  DashboardRealtimeContext,
  type DashboardRealtimeFrameHandler,
  type DashboardRealtimeReconnectHandler,
} from './dashboard-realtime-context';
import type { DashboardRealtimeSocketFactory } from './dashboard-realtime-transport';

/**
 * Opens the one real Dashboard WebSocket connection for `projectId` and
 * fans its frames out to every descendant that calls `useDashboardRealtime`
 * — NotificationsBell plus whichever list/detail page is on screen
 * (Connections, Rooms, Streams, Stream Detail, Webhooks all subscribe to
 * realtime independently). Without this, each of those mounts its own
 * `useDashboardRealtime` call, and each one mints its own token and opens
 * its own socket: up to two live connections per tab for the same project
 * on every one of those pages, for no reason a single shared one couldn't
 * cover.
 *
 * Mounted once, in AppShell, above everything that might want realtime.
 * `useDashboardRealtime` itself detects this provider via context and
 * subscribes here instead of connecting — see that hook for the other
 * half of this.
 */
export function DashboardRealtimeProvider({
  projectId,
  socketFactory,
  children,
}: {
  projectId: string;
  /** Test-only seam, threaded straight through to the one real connection. Never set in application code. */
  socketFactory?: DashboardRealtimeSocketFactory;
  children: React.ReactNode;
}) {
  const eventListenersRef = useRef(new Set<DashboardRealtimeFrameHandler>());
  const reconnectListenersRef = useRef(new Set<DashboardRealtimeReconnectHandler>());

  const dispatchEvent = useCallback((frame: Record<string, unknown>) => {
    for (const listener of eventListenersRef.current) listener(frame);
  }, []);
  const dispatchReconnect = useCallback(() => {
    for (const listener of reconnectListenersRef.current) listener();
  }, []);

  const { status } = useDashboardRealtime(projectId, {
    onEvent: dispatchEvent,
    onReconnected: dispatchReconnect,
    socketFactory,
  });

  const subscribe = useCallback(
    (onEvent?: DashboardRealtimeFrameHandler, onReconnected?: DashboardRealtimeReconnectHandler) => {
      if (onEvent) eventListenersRef.current.add(onEvent);
      if (onReconnected) reconnectListenersRef.current.add(onReconnected);
      return () => {
        if (onEvent) eventListenersRef.current.delete(onEvent);
        if (onReconnected) reconnectListenersRef.current.delete(onReconnected);
      };
    },
    [],
  );

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);

  return <DashboardRealtimeContext.Provider value={value}>{children}</DashboardRealtimeContext.Provider>;
}
