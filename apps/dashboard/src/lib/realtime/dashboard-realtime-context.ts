'use client';

import { createContext, useContext } from 'react';
import type { DashboardRealtimeStatus } from './use-dashboard-realtime';

export type DashboardRealtimeFrameHandler = (frame: Record<string, unknown>) => void;
export type DashboardRealtimeReconnectHandler = () => void;

export interface DashboardRealtimeContextValue {
  status: DashboardRealtimeStatus;
  /**
   * Registers a listener pair against the one real connection a
   * `DashboardRealtimeProvider` ancestor owns. Returns the unsubscribe.
   * Both handlers are optional so a caller that only wants one of the two
   * doesn't have to pass a no-op for the other.
   */
  subscribe(onEvent?: DashboardRealtimeFrameHandler, onReconnected?: DashboardRealtimeReconnectHandler): () => void;
}

/**
 * Deliberately separate from use-dashboard-realtime.ts and
 * dashboard-realtime-provider.tsx: this file exists only so both of those
 * can import the context object without importing each other — the
 * provider depends on the hook (to open the one real connection), and the
 * hook depends on this context (to detect a shared connection instead of
 * opening its own). Merging either pair into one file would create an
 * import cycle.
 */
export const DashboardRealtimeContext = createContext<DashboardRealtimeContextValue | null>(null);

export function useDashboardRealtimeContext(): DashboardRealtimeContextValue | null {
  return useContext(DashboardRealtimeContext);
}
