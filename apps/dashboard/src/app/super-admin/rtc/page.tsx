import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { getRtcOverview, listRtcRooms, type RoomStatus, type RtcRoomListItem, type RtcSfuNode } from '@/lib/super-admin/rtc';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatDuration, formatRelative } from '@/lib/format';

const PAGE_SIZE = 25;
const STATUSES: RoomStatus[] = ['ACTIVE', 'CLOSED'];

export default async function SuperAdminRtcPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; projectId?: string; page?: string }>;
}) {
  const { status: rawStatus, projectId, page: rawPage } = await searchParams;

  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/rtc');

  const status = (STATUSES as string[]).includes(rawStatus ?? '') ? (rawStatus as RoomStatus) : undefined;
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [overviewResult, roomsResult] = await Promise.allSettled([
    getRtcOverview(token),
    listRtcRooms(token, { status, projectId, limit: PAGE_SIZE, offset }),
  ]);

  if (overviewResult.status === 'rejected') {
    const reason = overviewResult.reason;
    if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) redirect('/dashboard');
    return (
      <ErrorState
        title="Could not load the RTC overview"
        description="The API is unreachable right now. Retry in a moment."
        retryHref="/super-admin/rtc"
      />
    );
  }

  const overview = overviewResult.value;
  const rooms = roomsResult.status === 'fulfilled' ? roomsResult.value : undefined;
  const filtered = Boolean(status || projectId);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="RTC"
        eyebrow="Super Admin"
        description="Real-time communication across every project on the platform — rooms, participants, connection health, and SFU fleet status."
      />

      <section>
        <SectionHeader
          title="Overview"
          subtitle={`Platform-wide, live snapshot. RTC minutes and connection stats over ${overview.range}.`}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Active rooms" value={formatCount(overview.activeRooms)} />
          <StatCard
            label="Active participants"
            value={formatCount(overview.activeParticipants)}
            hint="Participant.status = JOINED"
          />
          <StatCard
            label="Concurrent participants"
            value={formatCount(overview.concurrentParticipants)}
            hint="Fleet-reported, from SFU heartbeats"
          />
          <StatCard label="Rooms created today" value={formatCount(overview.roomsCreatedToday)} />
          <StatCard label="Rooms ended today" value={formatCount(overview.roomsEndedToday)} />
          <StatCard label="RTC minutes today" value={formatCount(Math.round(overview.rtcMinutesToday))} />
          <StatCard
            label={`RTC minutes (${overview.range})`}
            value={formatCount(Math.round(overview.rtcMinutesPeriod))}
          />
          <StatCard
            label="Connection failures"
            value={formatCount(overview.connectionFailures)}
            hint={overview.range}
            tone={overview.connectionFailures > 0 ? 'danger' : 'default'}
          />
          <StatCard label="Reconnections" value={formatCount(overview.reconnections)} hint={overview.range} />
          <StatCard
            label="Reconnect rate"
            value={overview.reconnectRate === null ? <NoDataYet label="No connections" /> : `${(overview.reconnectRate * 100).toFixed(1)}%`}
            hint={overview.range}
          />
          <StatCard
            label="Avg. session duration"
            value={
              overview.averageSessionDurationMs === null ? (
                <NoDataYet label="No completed sessions" />
              ) : (
                formatDuration(overview.averageSessionDurationMs)
              )
            }
            hint={overview.range}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="SFU fleet health"
          subtitle={`${formatCount(overview.sfu.totalNodes)} node(s) — ${formatCount(overview.sfu.healthyNodes)} healthy, ${formatCount(overview.sfu.drainingNodes)} draining, ${formatCount(overview.sfu.unhealthyNodes)} unhealthy.`}
        />
        {overview.sfu.nodes.length === 0 ? (
          <EmptyState title="No RTC servers registered" description="No SFU node has registered with the control plane yet." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.sfu.nodes.map((node) => (
              <SfuNodeCard key={node.id} node={node} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader
          title="Rooms"
          subtitle="Across every project and every developer on the platform, newest first."
        />

        {!rooms ? (
          <ErrorState
            title="Could not load rooms"
            description="Room list is unavailable right now. Overview stats above are unaffected."
            retryHref="/super-admin/rtc"
          />
        ) : rooms.items.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No rooms match these filters"
              description="Try a different status or project, or clear the filters."
              action={
                <ButtonLink href="/super-admin/rtc" variant="secondary">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState title="No rooms yet" description="A room appears here the moment any project's backend creates one." />
          )
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Room</TH>
                    <TH>Project</TH>
                    <TH>Developer</TH>
                    <TH>Status</TH>
                    <TH align="right">Participants</TH>
                    <TH>SFU node</TH>
                    <TH>Created</TH>
                  </THead>
                  <TBody>
                    {rooms.items.map((room) => (
                      <RoomRow key={room.id} room={room} />
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <div className="sm:hidden">
              <MobileList>
                {rooms.items.map((room) => (
                  <MobileRow key={room.id} href={`/super-admin/rtc/rooms/${room.id}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{room.name}</span>
                      <RoomStatusBadge status={room.status} />
                    </div>
                    <MobileField label="Project">{room.projectName}</MobileField>
                    <MobileField label="Developer">{room.developerEmail}</MobileField>
                    <MobileField label="Participants">
                      <span className="tabular">{formatCount(room.participantCount)}</span>
                    </MobileField>
                    <MobileField label="Created">
                      <span className="tabular">{formatRelative(room.createdAt)}</span>
                    </MobileField>
                  </MobileRow>
                ))}
              </MobileList>
            </div>

            <Pagination page={page} pageSize={PAGE_SIZE} total={rooms.total} status={status} projectId={projectId} />
          </>
        )}
      </section>
    </div>
  );
}

function RoomRow({ room }: { room: RtcRoomListItem }) {
  return (
    <TR interactive>
      <TD>
        <a
          href={`/super-admin/rtc/rooms/${room.id}`}
          className="font-medium text-fg hover:text-accent-text hover:underline"
        >
          {room.name}
        </a>
      </TD>
      <TD>
        <span className="truncate text-sm text-fg">{room.projectName}</span>
      </TD>
      <TD>
        <span className="truncate text-sm text-muted">{room.developerEmail}</span>
      </TD>
      <TD>
        <RoomStatusBadge status={room.status} />
      </TD>
      <TD align="right">
        <span className="tabular text-fg">{formatCount(room.participantCount)}</span>
      </TD>
      <TD>
        {room.rtcServer ? (
          <span className="font-mono text-xs text-muted">
            {room.rtcServer.name} · {room.rtcServer.region}
          </span>
        ) : (
          <Dash />
        )}
      </TD>
      <TD>
        <span className="tabular text-xs text-muted">{formatDateTime(room.createdAt)}</span>
      </TD>
    </TR>
  );
}

function RoomStatusBadge({ status }: { status: RoomStatus }) {
  return <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>{status === 'ACTIVE' ? 'Active' : 'Closed'}</Badge>;
}

const SFU_STATUS_TONE: Record<RtcSfuNode['status'], BadgeTone> = {
  HEALTHY: 'success',
  DRAINING: 'warning',
  UNHEALTHY: 'danger',
};

const SFU_STATUS_LABEL: Record<RtcSfuNode['status'], string> = {
  HEALTHY: 'Healthy',
  DRAINING: 'Draining',
  UNHEALTHY: 'Unhealthy',
};

function SfuNodeCard({ node }: { node: RtcSfuNode }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{node.name}</p>
          <p className="mt-0.5 text-xs text-muted">{node.region}</p>
        </div>
        <Badge tone={SFU_STATUS_TONE[node.status]}>{SFU_STATUS_LABEL[node.status]}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
        <MobileField label="Rooms">
          <span className="tabular">{formatCount(node.activeRooms)}</span>
        </MobileField>
        <MobileField label="Participants">
          <span className="tabular">{formatCount(node.activeParticipants)}</span>
        </MobileField>
        <MobileField label="Capacity">
          <span className="tabular">{formatCount(node.capacity)}</span>
        </MobileField>
        <MobileField label="Last heartbeat">
          <span className="tabular">{node.lastHeartbeatAt ? formatRelative(node.lastHeartbeatAt) : <Dash />}</span>
        </MobileField>
      </div>
    </li>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  status,
  projectId,
}: {
  page: number;
  pageSize: number;
  total: number;
  status?: string;
  projectId?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const hrefFor = (p: number) => {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    if (projectId) search.set('projectId', projectId);
    if (p > 1) search.set('page', String(p));
    const query = search.toString();
    return `/super-admin/rtc${query ? `?${query}` : ''}`;
  };

  return (
    <div className="flex items-center justify-between text-xs text-muted">
      <span>
        Page {formatCount(page)} of {formatCount(totalPages)} · {formatCount(total)} room(s) total
      </span>
      <div className="flex gap-2">
        <ButtonLink href={hrefFor(Math.max(1, page - 1))} size="sm" variant="secondary" aria-disabled={page <= 1}>
          Previous
        </ButtonLink>
        <ButtonLink
          href={hrefFor(Math.min(totalPages, page + 1))}
          size="sm"
          variant="secondary"
          aria-disabled={page >= totalPages}
        >
          Next
        </ButtonLink>
      </div>
    </div>
  );
}
