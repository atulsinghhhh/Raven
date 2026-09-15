'use client';

import { useCallback, useState } from 'react';
import type { LiveStreamStatus, LiveStreamSummary } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Dash } from '@/components/ui/states';
import { formatCount, formatDateTime, formatDuration } from '@/lib/format';
import { useDashboardRealtime } from '@/lib/realtime/use-dashboard-realtime';
import { useDebouncedRefetch } from '@/lib/realtime/use-debounced-refetch';
import type { DashboardRealtimeSocketFactory } from '@/lib/realtime/dashboard-realtime-transport';

const STATUS_FILTERS: LiveStreamStatus[] = ['CREATED', 'LIVE', 'ENDED'];

/**
 * The status filter nav, table, and mobile list for the Streams page — the
 * part that needs to be a client component so it can subscribe to
 * dashboard realtime and refresh when a stream starts or ends (Phase 5E).
 * Split out from page.tsx (a Server Component) the same way
 * RoomsList/ConnectionsList/WebhooksManager were: the initial data below
 * is exactly what page.tsx already fetched server-side, unchanged.
 */
export function StreamsList({
  projectId,
  basePath,
  initialStreams,
  status,
  realtimeSocketFactory,
}: {
  projectId: string;
  basePath: string;
  initialStreams: LiveStreamSummary[];
  status?: LiveStreamStatus;
  /** Test-only seam, threaded straight through to useDashboardRealtime. Never set in application code. */
  realtimeSocketFactory?: DashboardRealtimeSocketFactory;
}) {
  const [streams, setStreams] = useState(initialStreams);

  /**
   * Refetches the current status-filtered list and merges it in — same
   * "REST stays authoritative, WS is only a nudge" model as
   * Connections/Rooms/Webhooks. Upsert-by-id: a stream whose status just
   * changed is replaced with the fresh copy; a genuinely new one is
   * prepended.
   */
  const refetchLatest = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const query = params.toString();
      const res = await fetch(`/api/projects/${projectId}/live-streams${query ? `?${query}` : ''}`);
      if (!res.ok) return; // background nudge — fails silently, same as Connections/Rooms/Webhooks
      const fresh = (await res.json()) as LiveStreamSummary[];

      setStreams((prev) => {
        const freshById = new Map(fresh.map((s) => [s.id, s]));
        const updatedPrev = prev.map((s) => freshById.get(s.id) ?? s);
        const newOnes = fresh.filter((s) => !prev.some((p) => p.id === s.id));
        return [...newOnes, ...updatedPrev];
      });
    } catch {
      // Silent, same reasoning as every other list here: a background
      // nudge failing must not toast at the user for something they never
      // asked for.
    }
  }, [projectId, status]);

  const scheduleRefetch = useDebouncedRefetch(refetchLatest);

  const handleRealtimeEvent = useCallback(
    (frame: Record<string, unknown>) => {
      if (frame.type !== 'live_stream.started' && frame.type !== 'live_stream.ended') return;
      scheduleRefetch();
    },
    [scheduleRefetch],
  );

  // No replay on reconnect (Phase 5A's model) — refetch instead, same as
  // any other nudge.
  useDashboardRealtime(projectId, {
    onEvent: handleRealtimeEvent,
    onReconnected: refetchLatest,
    socketFactory: realtimeSocketFactory,
  });

  return (
    <>
      <div className="hidden sm:block">
        <TableWrap>
          <Table>
            <THead>
              <TH>Stream</TH>
              <TH>Status</TH>
              <TH>Host</TH>
              <TH align="right">Peak viewers</TH>
              <TH>Started</TH>
              <TH align="right">Duration</TH>
            </THead>
            <TBody>
              {streams.map((stream) => (
                <TR key={stream.id} interactive>
                  <TD className="max-w-[16rem]">
                    <a
                      href={`${basePath}/${stream.id}`}
                      className="block truncate text-sm font-medium text-fg hover:text-accent-text hover:underline"
                      title={stream.title}
                    >
                      {stream.title}
                    </a>
                    <span className="block truncate font-mono text-[0.6875rem] text-subtle">{stream.id}</span>
                  </TD>
                  <TD>
                    <StreamStatusBadge status={stream.status} />
                  </TD>
                  <TD>
                    {stream.hosts[0] ? (
                      <span className="truncate text-sm text-muted">{stream.hosts[0].identity}</span>
                    ) : (
                      <Dash />
                    )}
                  </TD>
                  <TD align="right">
                    <span className="tabular text-sm text-muted">{formatCount(stream.peakViewerCount)}</span>
                  </TD>
                  <TD>
                    {stream.startedAt ? (
                      <span className="tabular text-xs text-muted">{formatDateTime(stream.startedAt)}</span>
                    ) : (
                      <Dash />
                    )}
                  </TD>
                  <TD align="right">
                    <span className="tabular text-xs text-muted">{streamDuration(stream)}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </div>

      <div className="sm:hidden">
        <MobileList>
          {streams.map((stream) => (
            <MobileRow key={stream.id} href={`${basePath}/${stream.id}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{stream.title}</span>
                  <span className="block truncate font-mono text-[0.6875rem] text-subtle">{stream.id}</span>
                </span>
                <StreamStatusBadge status={stream.status} />
              </div>
              <div className="mt-3 border-t border-line pt-2">
                <MobileField label="Host">{stream.hosts[0]?.identity ?? '—'}</MobileField>
                <MobileField label="Peak viewers">{formatCount(stream.peakViewerCount)}</MobileField>
                <MobileField label="Duration">{streamDuration(stream)}</MobileField>
              </div>
            </MobileRow>
          ))}
        </MobileList>
      </div>
    </>
  );
}

export function StatusFilter({ base, current }: { base: string; current?: LiveStreamStatus }) {
  return (
    <nav
      aria-label="Filter by status"
      className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5"
    >
      <a
        href={base}
        aria-current={!current ? 'true' : undefined}
        className={`rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
          !current ? 'bg-accent-subtle text-accent-text' : 'text-muted hover:bg-surface-raised hover:text-fg'
        }`}
      >
        All
      </a>
      {STATUS_FILTERS.map((status) => (
        <a
          key={status}
          href={`${base}?status=${status}`}
          aria-current={current === status ? 'true' : undefined}
          className={`rounded-sm px-2 py-1 text-xs font-medium capitalize transition-colors ${
            current === status
              ? 'bg-accent-subtle text-accent-text'
              : 'text-muted hover:bg-surface-raised hover:text-fg'
          }`}
        >
          {status.toLowerCase()}
        </a>
      ))}
    </nav>
  );
}

export function StreamStatusBadge({ status }: { status: LiveStreamSummary['status'] }) {
  if (status === 'LIVE') return <Badge tone="live">Live</Badge>;
  if (status === 'ENDED') return <Badge tone="neutral">Ended</Badge>;
  if (status === 'CREATED') return <Badge tone="info">Created</Badge>;
  return <Badge tone="warning">{status.toLowerCase()}</Badge>;
}

/** LIVE streams measure against now(); ended ones against their own endedAt. Never started = no duration to show. */
function streamDuration(stream: LiveStreamSummary): string {
  if (!stream.startedAt) return '—';
  const start = new Date(stream.startedAt).getTime();
  const end = stream.endedAt ? new Date(stream.endedAt).getTime() : Date.now();
  return formatDuration(end - start);
}
