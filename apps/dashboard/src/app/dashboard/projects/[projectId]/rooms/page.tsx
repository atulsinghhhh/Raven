import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import type { ConnectionSummary, RoomWithLiveState } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ProductTabs, rtcTabs } from '@/components/shell/product-tabs';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { IconRooms } from '@/components/ui/icons';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';

// listConnections is capped at 200 server-side; the per-room "active
// connections" column is derived from exactly that window and is labelled
// as such rather than presented as an all-time total.
const CONNECTION_SCAN_LIMIT = 200;

export default async function RoomsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  // Rooms are load-bearing for this page; the connection scan that backs the
  // derived column is not, so it degrades to "Unknown" on its own.
  const [roomsResult, connectionsResult] = await Promise.allSettled([
    ravenApi.listRooms(token, projectId),
    ravenApi.listConnections(token, projectId, { limit: CONNECTION_SCAN_LIMIT }),
  ]);

  if (roomsResult.status === 'rejected') {
    const reason = roomsResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    if (reason instanceof ApiError && reason.status === 404) {
      return (
        <EmptyState
          title="Project not found"
          description="This project may have been archived, or it belongs to a different account."
          action={
            <ButtonLink href="/dashboard/projects" variant="primary">
              Back to projects
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load rooms"
        description="The Control API is unreachable right now. Your rooms are unaffected — retry in a moment."
        retryHref={`/dashboard/projects/${projectId}/rooms`}
      />
    );
  }

  const rooms = roomsResult.value;
  const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value : undefined;

  const base = `/dashboard/projects/${projectId}`;
  const activeByRoomId = countActiveConnections(rooms, connections);

  // A room whose liveParticipantCount is null means the SFU could not be
  // reached for it: that is not the same as an idle room, so it is excluded
  // from the aggregates instead of being counted as zero.
  const known = rooms.filter((r) => r.liveParticipantCount !== null);
  const unknownCount = rooms.length - known.length;
  const liveStateAvailable = known.length > 0;
  const roomsWithParticipants = known.filter((r) => (r.liveParticipantCount ?? 0) > 0).length;
  const liveParticipants = known.reduce((sum, r) => sum + (r.liveParticipantCount ?? 0), 0);
  const unknownHint = unknownCount > 0 ? `${formatCount(unknownCount)} with unknown live state` : undefined;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Rooms"
        description="Every room your backend has created in this project, with live occupancy read from the SFU at page load."
        actions={
          <ButtonLink href={`${base}/quickstart`} variant="secondary">
            How rooms are created
          </ButtonLink>
        }
      />
      <ProductTabs tabs={rtcTabs(base)} active="Rooms" />

      {rooms.length === 0 ? (
        <EmptyState
          icon={<IconRooms className="size-7" />}
          title="No rooms yet"
          description={
            <>
              Livqeno never creates rooms from the dashboard. Your backend creates them by calling the Control API with a
              project API key — <code className="font-mono text-xs text-fg">POST /v1/rooms</code> via{' '}
              <code className="font-mono text-xs text-fg">@ravenkash/server</code> — and they appear here the moment they
              exist.
            </>
          }
          action={
            <>
              <ButtonLink href={`${base}/quickstart`} variant="primary">
                Open quickstart
              </ButtonLink>
              <ButtonLink href={`${base}/api-keys`} variant="secondary">
                Create an API key
              </ButtonLink>
            </>
          }
        />
      ) : (
        <>
          <section>
            <SectionHeader title="Occupancy" subtitle="Live state from the SFU, not a stored history." />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label="Rooms" value={formatCount(rooms.length)} hint="All rooms in this project" />
              <StatCard
                label="Rooms with live participants"
                value={
                  liveStateAvailable ? (
                    formatCount(roomsWithParticipants)
                  ) : (
                    <NoDataYet label="SFU unreachable" />
                  )
                }
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
      )}
    </div>
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
