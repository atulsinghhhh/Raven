'use client';

import { useCallback, useState } from 'react';
import type { ConnectionLifecycleState, ConnectionSummary } from '@/lib/api-client';
import { ConnectionStateBadge } from '@/components/ui/badge';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { DistributionBar } from '@/components/ui/chart';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Dash, EmptyState, NoDataYet } from '@/components/ui/states';
import { MonoId } from '@/components/ui/mono';
import { ButtonLink } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { handleSessionExpiry } from '@/lib/session-expiry';
import { formatCount, formatDuration, formatRelative } from '@/lib/format';
import { useDashboardRealtime } from '@/lib/realtime/use-dashboard-realtime';
import { useDebouncedRefetch } from '@/lib/realtime/use-debounced-refetch';
import type { DashboardRealtimeSocketFactory } from '@/lib/realtime/dashboard-realtime-transport';

const STATE_BAR: Record<ConnectionSummary['state'], string> = {
  CONNECTED: 'bg-success',
  CONNECTING: 'bg-warning',
  RECONNECTING: 'bg-warning',
  DISCONNECTED: 'bg-line-strong',
  FAILED: 'bg-danger',
};

const STATES: ConnectionLifecycleState[] = ['CONNECTED', 'CONNECTING', 'RECONNECTING', 'DISCONNECTED', 'FAILED'];

function matchesSearch(c: ConnectionSummary, needle: string): boolean {
  return (
    c.publicId.toLowerCase().includes(needle) ||
    c.participantIdentity.toLowerCase().includes(needle) ||
    c.roomName.toLowerCase().includes(needle)
  );
}

/**
 * Everything below the filter bar on the connections page: stats,
 * distribution, the table, and now "Load more". Split out from page.tsx
 * (a Server Component) because loading another page is a client
 * interaction with nothing server-side to re-render it — the initial
 * batch below is exactly what page.tsx already fetched, unchanged.
 *
 * Keying this component on the current filters (state/room/q — see
 * page.tsx) forces a full remount, and therefore a reset of everything
 * below, whenever a filter changes: no stale cursor from a previous
 * query ever gets reused (spec §7).
 */
export function ConnectionsList({
  projectId,
  initialConnections,
  initialNextCursor,
  initialHasMore,
  state,
  room,
  q,
  realtimeSocketFactory,
}: {
  projectId: string;
  initialConnections: ConnectionSummary[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
  state?: ConnectionLifecycleState;
  room?: string;
  q?: string;
  /** Test-only seam, threaded straight through to useDashboardRealtime. Never set in application code. */
  realtimeSocketFactory?: DashboardRealtimeSocketFactory;
}) {
  const needle = q?.trim().toLowerCase();
  const [connections, setConnections] = useState(initialConnections);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  const base = `/dashboard/projects/${projectId}`;

  async function loadMore() {
    // Guards against a second click firing a concurrent request while the
    // first is still in flight — the button is also disabled while
    // loadingMore is true, this is the belt-and-suspenders check.
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);

    try {
      const params = new URLSearchParams();
      if (state) params.set('state', state);
      if (room) params.set('room', room);
      params.set('cursor', nextCursor);

      const res = await fetch(`/api/projects/${projectId}/connections?${params.toString()}`);
      if (handleSessionExpiry(res)) return;
      if (!res.ok) {
        toast.error('Failed to load more connections.');
        return;
      }
      const page = (await res.json()) as { data: ConnectionSummary[]; nextCursor: string | null; hasMore: boolean };

      // The API has no server-side text search (see page.tsx) — apply the
      // same client-only filter to the new batch that the initial batch
      // already went through, so "Load more" can't reintroduce rows the
      // current search would have hidden.
      const filtered = needle ? page.data.filter((c) => matchesSearch(c, needle)) : page.data;

      setConnections((prev) => [...prev, ...filtered]);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      toast.error('Failed to load more connections.');
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Refetches the current first page (same filters, no cursor) and merges
   * it into whatever is already loaded — Phase 5C's "REST stays
   * authoritative, WS is only a nudge to go re-read it" model. Never
   * touches `nextCursor`/`hasMore`: those track where "Load more" should
   * continue from, which has nothing to do with a fresh read of page one
   * and must survive this refresh unchanged.
   *
   * The merge is upsert-by-publicId, not replace: matching rows are
   * updated in place, genuinely new ones are prepended, and anything
   * loaded further down via "Load more" that isn't part of the fresh page
   * is left exactly as it was. That's what makes two identical nudges (or
   * one delivered twice) harmless — the second merge is a no-op over
   * data that's already current, never a duplicate row.
   */
  const refetchLatest = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (state) params.set('state', state);
      if (room) params.set('room', room);

      const res = await fetch(`/api/projects/${projectId}/connections?${params.toString()}`);
      if (!res.ok) return; // a background nudge failing silently — see toast note below
      const page = (await res.json()) as { data: ConnectionSummary[]; nextCursor: string | null; hasMore: boolean };
      const fresh = needle ? page.data.filter((c) => matchesSearch(c, needle)) : page.data;

      setConnections((prev) => {
        const freshById = new Map(fresh.map((c) => [c.publicId, c]));
        const updatedPrev = prev.map((c) => freshById.get(c.publicId) ?? c);
        const newOnes = fresh.filter((c) => !prev.some((p) => p.publicId === c.publicId));
        return [...newOnes, ...updatedPrev];
      });
    } catch {
      // Deliberately silent, unlike loadMore's toast.error above: this
      // runs in the background on every realtime nudge, and a flaky
      // socket would otherwise mean a toast storm for something the user
      // never asked for. REST remains the source of truth regardless —
      // the next successful poll/nudge/manual reload catches up.
    }
  }, [projectId, state, room, needle]);

  const scheduleRefetch = useDebouncedRefetch(refetchLatest);

  const handleRealtimeEvent = useCallback(
    (frame: Record<string, unknown>) => {
      if (frame.type !== 'connection.state_changed') return;
      // An optimization only, never an authorization mechanism (Phase 5C
      // §4 — the server already scoped this event to our project before
      // it ever reached the socket): a room filter that can't possibly
      // match skips the refetch instead of triggering one that would
      // change nothing.
      const eventRoomId = typeof frame.roomId === 'string' ? frame.roomId : undefined;
      if (room && eventRoomId && eventRoomId !== room) return;
      scheduleRefetch();
    },
    [room, scheduleRefetch],
  );

  // Missed events while disconnected are never replayed (Phase 5A's
  // model has no replay primitive) — a reconnect refetches instead, same
  // as any other nudge, just triggered by the transport itself rather
  // than a specific event.
  useDashboardRealtime(projectId, {
    onEvent: handleRealtimeEvent,
    onReconnected: refetchLatest,
    socketFactory: realtimeSocketFactory,
  });

  const counts = STATES.map((s) => ({
    label: s.charAt(0) + s.slice(1).toLowerCase(),
    value: connections.filter((c) => c.state === s).length,
    className: STATE_BAR[s],
  }));

  const live = connections.filter((c) => c.state === 'CONNECTED' || c.state === 'RECONNECTING').length;
  const withDuration = connections.filter((c) => c.durationMs !== null);
  const avgDuration =
    withDuration.length > 0
      ? Math.round(withDuration.reduce((sum, c) => sum + (c.durationMs ?? 0), 0) / withDuration.length)
      : null;

  if (connections.length === 0) {
    return (
      <EmptyState
        title="No connections match these filters"
        description="Try a different state or room, or clear the filters to see everything recorded."
        action={
          <ButtonLink href={`${base}/connections`} variant="secondary">
            Clear filters
          </ButtonLink>
        }
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Records shown" value={formatCount(connections.length)} hint="Loaded so far" />
        <StatCard label="Currently live" value={formatCount(live)} hint="Connected or reconnecting" />
        <StatCard
          label="Failed"
          value={formatCount(connections.filter((c) => c.state === 'FAILED').length)}
          tone={connections.some((c) => c.state === 'FAILED') ? 'danger' : 'default'}
        />
        <StatCard
          label="Avg. duration"
          value={avgDuration === null ? <NoDataYet label="No completed" /> : formatDuration(avgDuration)}
          hint={`${withDuration.length} completed`}
        />
      </div>

      <section>
        <SectionHeader title="State distribution" subtitle="Across the records loaded below." />
        <div className="rounded-lg border border-line bg-surface p-4">
          <DistributionBar segments={counts} caption="Connection states across the records loaded" />
        </div>
      </section>

      <TableWrap className="hidden sm:block">
        <Table>
          <THead>
            <TH>Connection</TH>
            <TH>Room</TH>
            <TH>Participant</TH>
            <TH>Status</TH>
            <TH>Region</TH>
            <TH align="right">Duration</TH>
            <TH>SDK</TH>
            <TH align="right">Started</TH>
          </THead>
          <TBody>
            {connections.map((c) => (
              <TR key={c.publicId} interactive>
                <TD className="max-w-[13rem]">
                  <MonoId value={c.publicId} href={`${base}/connections/${c.publicId}`} />
                </TD>
                <TD className="max-w-[11rem]">
                  <span className="block truncate text-sm text-fg" title={c.roomName}>
                    {c.roomName}
                  </span>
                </TD>
                <TD className="max-w-[11rem]">
                  <span className="block truncate text-sm text-muted" title={c.participantIdentity}>
                    {c.participantIdentity}
                  </span>
                </TD>
                <TD>
                  <ConnectionStateBadge state={c.state} />
                </TD>
                <TD className="text-sm text-muted">{c.region ?? <Dash />}</TD>
                <TD align="right" className="tabular text-sm text-muted">
                  {formatDuration(c.durationMs)}
                </TD>
                <TD className="text-sm text-muted">
                  {c.sdkVersion ? <span className="font-mono text-xs">{c.sdkVersion}</span> : <Dash />}
                </TD>
                <TD align="right" className="tabular text-xs text-subtle">
                  <span title={new Date(c.startedAt).toISOString()}>{formatRelative(c.startedAt)}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <div className="sm:hidden">
        <MobileList>
          {connections.map((c) => (
            <MobileRow key={c.publicId} href={`${base}/connections/${c.publicId}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{c.participantIdentity}</span>
                  <span className="block truncate text-xs text-muted">{c.roomName}</span>
                </span>
                <ConnectionStateBadge state={c.state} />
              </div>
              <div className="mt-3 border-t border-line pt-2">
                <MobileField label="Connection">
                  <span className="font-mono text-[0.6875rem]">{c.publicId}</span>
                </MobileField>
                <MobileField label="Duration">{formatDuration(c.durationMs)}</MobileField>
                <MobileField label="Started">{formatRelative(c.startedAt)}</MobileField>
              </div>
            </MobileRow>
          ))}
        </MobileList>
      </div>

      <div className="flex flex-col items-center gap-2 pt-2">
        {hasMore ? (
          <Button variant="secondary" size="sm" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        ) : (
          <p className="text-xs text-subtle">No more connections.</p>
        )}
        {needle && <p className="text-xs text-subtle">Text search filters loaded records only, not full history.</p>}
      </div>
    </>
  );
}
