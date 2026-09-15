'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * How long to wait after a realtime nudge before refetching, resetting on
 * every additional nudge that arrives in the meantime. A burst of
 * telemetry-driven events (several connections in the same room flipping
 * state within milliseconds of each other) collapses into one refetch
 * instead of one per event (Phase 5C §5's "avoid unnecessary simultaneous
 * refetch storms"). Shared by every realtime list/detail page — Connections,
 * Rooms, Streams, Webhooks, Notifications — so they all coalesce on the
 * same window.
 */
const REALTIME_REFETCH_DEBOUNCE_MS = 400;

/**
 * Wraps a `refetchLatest` callback with the debounce-on-nudge behavior every
 * Phase 5B-5F realtime page needs: call the returned `scheduleRefetch()`
 * from a `useDashboardRealtime` event handler, and a burst of nudges runs
 * `refetchLatest` once, `REALTIME_REFETCH_DEBOUNCE_MS` after the last one.
 *
 * `refetchLatest` is read through a ref updated after every render (the same
 * always-latest pattern `useDashboardRealtime` uses for its own callbacks),
 * so passing a new inline function each render never resets the pending
 * timer — only unmounting does, via the cleanup below.
 */
export function useDebouncedRefetch(refetchLatest: () => void | Promise<void>): () => void {
  const refetchLatestRef = useRef(refetchLatest);
  useEffect(() => {
    refetchLatestRef.current = refetchLatest;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scheduleRefetch = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      void refetchLatestRef.current();
    }, REALTIME_REFETCH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, []);

  return scheduleRefetch;
}
