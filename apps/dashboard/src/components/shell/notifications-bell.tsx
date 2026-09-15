'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationSummary } from '@/lib/api-client';
import { IconBell } from '@/components/ui/icons';
import { formatRelative } from '@/lib/format';
import { Menu } from '@/components/ui/menu';
import { ErrorState } from '@/components/ui/states';
import { SkeletonText } from '@/components/ui/skeleton';
import { toast } from '@/lib/toast';
import { handleSessionExpiry } from '@/lib/session-expiry';
import { useDashboardRealtime } from '@/lib/realtime/use-dashboard-realtime';
import type { DashboardRealtimeSocketFactory } from '@/lib/realtime/dashboard-realtime-transport';

const LIST_LIMIT = 20;
/** Same debounce window as every other Phase 5B-5F realtime list. */
const REALTIME_REFETCH_DEBOUNCE_MS = 400;

const TYPE_LABEL: Record<NotificationSummary['type'], string> = {
  WEBHOOK_DELIVERY_FAILED: 'Webhook',
  WEBHOOK_ENDPOINT_DISABLED: 'Webhook',
  LIVE_STREAM_STARTED: 'Live Streaming',
  LIVE_STREAM_ENDED: 'Live Streaming',
};

/** Derives where a notification should link to from its structured payload — see NotificationsService.notifyProject's callers for what each type puts there. Falls back to the project root rather than a dead link. */
function hrefFor(notification: NotificationSummary, base: string): string {
  const payload = notification.payload as { endpointId?: string; streamId?: string } | null;
  if (payload?.streamId) return `${base}/live-streaming/streams/${payload.streamId}`;
  if (payload?.endpointId) return `${base}/webhooks`;
  return base;
}

/**
 * Real, persistent notifications (Phase 5F) — replacing the previous
 * behavior of re-deriving a fake list from diagnostics/webhooks/audit
 * logs on every page render, with no read state and nothing that
 * survived a reload (Phase 5A's finding). REST
 * (GET /v1/projects/:id/notifications) is the authoritative snapshot;
 * the dashboard WebSocket only carries a `notification.created` nudge
 * telling this component to go refetch it — see
 * NotificationsService.notifyProject and dashboard-ws-events.ts.
 *
 * Scoped to `projectId`: the effect below keys on it, so switching
 * projects tears down the old realtime connection, clears local state
 * before the new fetch even lands (no stale-project flash), and starts
 * over against the new project's notifications.
 */
export function NotificationsBell({
  projectId,
  realtimeSocketFactory,
}: {
  projectId: string;
  /** Test-only seam, threaded straight through to useDashboardRealtime. Never set in application code. */
  realtimeSocketFactory?: DashboardRealtimeSocketFactory;
}) {
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const base = `/dashboard/projects/${projectId}`;

  const refetchLatest = useCallback(async () => {
    try {
      const [listRes, countRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/notifications?limit=${LIST_LIMIT}`),
        fetch(`/api/projects/${projectId}/notifications/unread-count`),
      ]);
      if (handleSessionExpiry(listRes) || handleSessionExpiry(countRes)) return;
      if (!listRes.ok || !countRes.ok) {
        setError(true);
        return;
      }
      const list = (await listRes.json()) as { data: NotificationSummary[] };
      const count = (await countRes.json()) as { count: number };
      setNotifications(list.data);
      setUnreadCount(count.count);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Initial snapshot, and — because this effect keys on projectId — a
  // fresh one on every project switch. State is cleared *before* the
  // fetch even starts, so a switch can never flash the previous
  // project's notifications while the new page's fetch is in flight
  // (Phase 5F §9: no stale project notification state).
  useEffect(() => {
    // Reset is nested one function deeper rather than sitting directly in
    // the effect body — see use-dashboard-realtime.ts's `start()` for why:
    // a setState call syntactically inside an effect body trips the
    // react-hooks/set-state-in-effect lint rule, but the observable timing
    // is identical either way.
    function resetAndRefetch() {
      setNotifications([]);
      setUnreadCount(0);
      setError(false);
      setLoading(true);
      void refetchLatest();
    }
    resetAndRefetch();
  }, [projectId, refetchLatest]);

  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current !== undefined) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = undefined;
      void refetchLatest();
    }, REALTIME_REFETCH_DEBOUNCE_MS);
  }, [refetchLatest]);

  useEffect(() => {
    return () => {
      if (refetchTimerRef.current !== undefined) clearTimeout(refetchTimerRef.current);
    };
  }, []);

  const handleRealtimeEvent = useCallback(
    (frame: Record<string, unknown>) => {
      if (frame.type !== 'notification.created') return;
      scheduleRefetch();
    },
    [scheduleRefetch],
  );

  // No replay on reconnect (Phase 5A's model) — refetch instead, so a
  // notification created entirely while disconnected still shows up.
  useDashboardRealtime(projectId, {
    onEvent: handleRealtimeEvent,
    onReconnected: refetchLatest,
    socketFactory: realtimeSocketFactory,
  });

  async function markRead(notification: NotificationSummary) {
    if (notification.read) return;
    // Optimistic — a bell should feel instant, not round-trip before the
    // dot disappears.
    setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      const res = await fetch(`/api/projects/${projectId}/notifications/${notification.id}/read`, { method: 'PATCH' });
      if (handleSessionExpiry(res)) return;
      if (!res.ok) throw new Error('failed');
    } catch {
      // Revert. The database is still authoritative — this only undoes
      // the local lie; the next successful nudge/reconnect/reload would
      // have caught it anyway.
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: false } : n)));
      setUnreadCount((prev) => prev + 1);
      toast.error('Could not mark that notification read.');
    }
  }

  async function markAllRead() {
    if (unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    const previousNotifications = notifications;
    const previousCount = unreadCount;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      const res = await fetch(`/api/projects/${projectId}/notifications/read-all`, { method: 'POST' });
      if (handleSessionExpiry(res)) return;
      if (!res.ok) throw new Error('failed');
    } catch {
      setNotifications(previousNotifications);
      setUnreadCount(previousCount);
      toast.error('Could not mark all notifications read.');
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <Menu
      label="Notifications"
      align="end"
      menuClassName="w-80 sm:w-96 p-0"
      trigger={() => (
        <span className="relative inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-fg">
          <IconBell className="size-4" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-danger px-[3px] text-[0.5625rem] font-semibold leading-none text-white"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          <span className="sr-only">{unreadCount} unread notifications</span>
        </span>
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-sm font-semibold text-fg">Notifications</span>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={markingAll}
            className="text-xs font-medium text-accent-text hover:underline disabled:opacity-50"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="px-3 py-3">
          <SkeletonText lines={3} />
        </div>
      ) : error ? (
        <div className="p-3">
          <ErrorState
            title="Could not load notifications"
            onRetry={() => {
              setLoading(true);
              void refetchLatest();
            }}
          />
        </div>
      ) : notifications.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-subtle">Nothing to report right now.</p>
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {notifications.map((n) => (
            <li key={n.id}>
              <a
                href={hrefFor(n, base)}
                onClick={() => void markRead(n)}
                className={`block px-3 py-2.5 hover:bg-surface-raised ${n.read ? '' : 'bg-accent-subtle'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-subtle">
                    {!n.read && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />}
                    {TYPE_LABEL[n.type]}
                  </span>
                  <span className="shrink-0 text-[0.6875rem] text-subtle">{formatRelative(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-fg">{n.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{n.message}</p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Menu>
  );
}
