'use client';

import { useCallback, useMemo } from 'react';
import { useState } from 'react';
import type { ConnectionSummary, RoomWithLiveState } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { NoDataYet } from '@/components/ui/states';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';
import { useDashboardRealtime } from '@/lib/realtime/use-dashboard-realtime';
import { useDebouncedRefetch } from '@/lib/realtime/use-debounced-refetch';
import type { DashboardRealtimeSocketFactory } from '@/lib/realtime/dashboard-realtime-transport';

/**
 * The occupancy stats, table, and mobile list for the Rooms page — the
 * part that needs to be a client component so it can subscribe to
 * dashboard realtime and refresh when a room is created (Phase 5C). Split
 * out from page.tsx (a Server Component) the same way ConnectionsList was
 * split from the Connections page: the initial data below is exactly what
 * page.tsx already fetched server-side, unchanged.
 *
 * `connections` is passed through once, for the "active connections per
 * room" derived column — it does not live-update in this phase. Only
 * `rooms` itself refreshes on a `room.created` nudge; a newly created room
 * starts with no connections regardless, so this is not a gap the
 * derived column needs to react to yet.
 */
export function RoomsList({
  projectId,
  initialRooms,
  connections,
  realtimeSocketFactory,
}: {
  projectId: string;
  initialRooms: RoomWithLiveState[];
  connections: ConnectionSummary[] | undefined;
  /** Test-only seam, threaded straight through to useDashboardRealtime. Never set in application code. */
  realtimeSocketFactory?: DashboardRealtimeSocketFactory;
}) {
  const [rooms, setRooms] = useState(initialRooms);
  const base = `/dashboard/projects/${projectId}`;

  /**
   * Refetches the room list and merges it in — Phase 5C's "REST stays
   * authoritative, WS is only a nudge" model, same shape as
   * ConnectionsList.refetchLatest. Upsert-by-id: a room already known
   * (with its SFU-derived liveParticipantCount) is replaced with the
   * fresh copy, and anything genuinely new is prepended. Rooms has no
   * pagination/cursor to preserve, unlike Connections, so there is
   * nothing else this must avoid touching.
   */
  const refetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/rooms`);
      if (!res.ok) return; // background nudge — fails silently, REST/manual reload remain the fallback
      const fresh = (await res.json()) as RoomWithLiveState[];

      setRooms((prev) => {
        const freshById = new Map(fresh.map((r) => [r.id, r]));
        const updatedPrev = prev.map((r) => freshById.get(r.id) ?? r);
        const newOnes = fresh.filter((r) => !prev.some((p) => p.id === r.id));
        return [...newOnes, ...updatedPrev];
      });
    } catch {
      // Silent, same reasoning as ConnectionsList: a background nudge
      // failing must not toast at the user for something they never
      // asked for.
    }
  }, [projectId]);

  const scheduleRefetch = useDebouncedRefetch(refetchLatest);

  const handleRealtimeEvent = useCallback(
    (frame: Record<string, unknown>) => {
      if (frame.type !== 'room.created') return;
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

  const activeByRoomId = useMemo(() => countActiveConnections(rooms, connections), [rooms, connections]);

  // A room whose liveParticipantCount is null means the SFU could not be
  // reached for it: that is not the same as an idle room, so it is
  // excluded from the aggregates instead of being counted as zero.
  const known = rooms.filter((r) => r.liveParticipantCount !== null);
  const unknownCount = rooms.length - known.length;
  const liveStateAvailable = known.length > 0;
  const roomsWithParticipants = known.filter((r) => (r.liveParticipantCount ?? 0) > 0).length;
  const liveParticipants = known.reduce((sum, r) => sum + (r.liveParticipantCount ?? 0), 0);
  const unknownHint = unknownCount > 0 ? `${formatCount(unknownCount)} with unknown live state` : undefined;

  return (
    <>
      <section>
        <SectionHeader title="Occupancy" subtitle="Live state from the SFU, not a stored history." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Rooms" value={formatCount(rooms.length)} hint="All rooms in this project" />
          <StatCard
            label="Rooms with live participants"
            value={liveStateAvailable ? formatCount(roomsWithParticipants) : <NoDataYet label="SFU unreachable" />}
            hint={liveStateAvailable ? unknownHint : 'Live occupancy could not be read'}
          />
          <StatCard
            label="Live participants"
            value={liveStateAvailable ? formatCount(liveParticipants) : <NoDataYet label="SFU unreachable" />}
            hint={liveStateAvailable ? unknownHint : 'Live occupancy could not be read'}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="All rooms"
          subtitle={
            connections
              ? `Active connections counted from the ${formatCount(connections.length)} most recent connection records.`
              : 'Connection records are unavailable right now, so active connections show as unknown.'
          }
        />

        {/* Desktop: a real table. Below sm the same records render as cards. */}
        <div className="hidden sm:block">
          <TableWrap>
            <Table>
              <THead>
                <TH>Room</TH>
                <TH align="right">Participants (live)</TH>
                <TH align="right">Active connections</TH>
                <TH>Status</TH>
                <TH>Created</TH>
              </THead>
              <TBody>
                {rooms.map((room) => (
                  <TR key={room.id} interactive>
                    <TD>
                      <a
                        href={`${base}/rooms/${room.id}`}
                        className="font-medium text-fg hover:text-accent-text hover:underline"
                      >
                        {room.name}
                      </a>
                    </TD>
                    <TD align="right">
                      {room.liveParticipantCount === null ? (
                        <NoDataYet label="Unknown" />
                      ) : (
                        <span className="tabular text-fg">{formatCount(room.liveParticipantCount)}</span>
                      )}
                    </TD>
                    <TD align="right">
                      {connections ? (
                        <span className="tabular text-muted">{formatCount(activeByRoomId.get(room.id) ?? 0)}</span>
                      ) : (
                        <NoDataYet label="Unknown" />
                      )}
                    </TD>
                    <TD>
                      <LiveStatusBadge count={room.liveParticipantCount} />
                    </TD>
                    <TD>
                      <span className="tabular text-xs text-muted">{formatDateTime(room.createdAt)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </div>

        <div className="sm:hidden">
          <MobileList>
            {rooms.map((room) => (
              <MobileRow key={room.id} href={`${base}/rooms/${room.id}`}>
                <div className="mb-2 flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-fg">{room.name}</span>
                  <LiveStatusBadge count={room.liveParticipantCount} />
                </div>
                <MobileField label="Participants (live)">
                  {room.liveParticipantCount === null ? (
                    <NoDataYet label="Unknown" />
                  ) : (
                    <span className="tabular">{formatCount(room.liveParticipantCount)}</span>
                  )}
                </MobileField>
                <MobileField label="Active connections">
                  {connections ? (
                    <span className="tabular">{formatCount(activeByRoomId.get(room.id) ?? 0)}</span>
                  ) : (
                    <NoDataYet label="Unknown" />
                  )}
                </MobileField>
                <MobileField label="Created">
                  <span className="tabular">{formatRelative(room.createdAt)}</span>
                </MobileField>
              </MobileRow>
            ))}
          </MobileList>
        </div>
      </section>
    </>
  );
}

/**
 * Three states, never two: a room we know is busy, a room we know is empty,
 * and a room whose live state the SFU could not tell us about.
 */
function LiveStatusBadge({ count }: { count: number | null }) {
  if (count === null) return <Badge tone="warning">Unknown</Badge>;
  return count > 0 ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Idle</Badge>;
}

/**
 * Counts currently-connected connection records per room. Connection records
 * carry roomId when the room still exists and always carry roomName, so name
 * is used as the fallback join key: without double counting either way.
 */
function countActiveConnections(
  rooms: RoomWithLiveState[],
  connections: ConnectionSummary[] | undefined,
): Map<string, number> {
  const byRoomId = new Map<string, number>();
  if (!connections) return byRoomId;

  const roomIdByName = new Map(rooms.map((room) => [room.name, room.id]));

  for (const connection of connections) {
    if (connection.state !== 'CONNECTED') continue;
    const roomId = connection.roomId ?? roomIdByName.get(connection.roomName);
    if (!roomId) continue;
    byRoomId.set(roomId, (byRoomId.get(roomId) ?? 0) + 1);
  }

  return byRoomId;
}
