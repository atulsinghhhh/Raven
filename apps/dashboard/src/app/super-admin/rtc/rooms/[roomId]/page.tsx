import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { getRtcRoom, type RtcRoomParticipantSummary } from '@/lib/super-admin/rtc';
import { Badge, ConnectionStateBadge } from '@/components/ui/badge';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { KeyValue, KeyValueGrid, MonoId } from '@/components/ui/mono';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatDuration } from '@/lib/format';

export default async function SuperAdminRtcRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/rtc');

  let room;
  try {
    room = await getRtcRoom(token, roomId);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) redirect('/dashboard');
    if (err instanceof ApiError && err.status === 404) {
      return (
        <EmptyState
          title="Room not found"
          description="This room may not exist, or its id was mistyped."
          action={
            <ButtonLink href="/super-admin/rtc" variant="primary">
              Back to RTC
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this room"
        description="The API is unreachable right now. Retry in a moment."
        retryHref={`/super-admin/rtc/rooms/${roomId}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={room.name}
        eyebrow="Super Admin · RTC"
        breadcrumb={{ label: 'All rooms', href: '/super-admin/rtc' }}
        description={`${room.projectName} — owned by ${room.developerEmail}`}
        meta={
          <Badge tone={room.status === 'ACTIVE' ? 'success' : 'neutral'}>
            {room.status === 'ACTIVE' ? 'Active' : 'Closed'}
          </Badge>
        }
      />

      <Card>
        <CardHeader title="Room" subtitle="Identity, ownership, and infrastructure assignment." />
        <KeyValueGrid>
          <KeyValue label="Room ID">
            <MonoId value={room.id} copy />
          </KeyValue>
          <KeyValue label="Project">{room.projectName}</KeyValue>
          <KeyValue label="Developer">{room.developerEmail}</KeyValue>
          <KeyValue label="Environment">{room.environment}</KeyValue>
          <KeyValue label="Created">
            <span className="tabular">{formatDateTime(room.createdAt)}</span>
          </KeyValue>
          <KeyValue label="Started">
            <span className="tabular">{formatDateTime(room.startedAt)}</span>
          </KeyValue>
          <KeyValue label="Ended">
            <span className="tabular">{room.endedAt ? formatDateTime(room.endedAt) : <Dash />}</span>
          </KeyValue>
          <KeyValue label="SFU node">
            {room.rtcServer ? (
              <span className="font-mono text-xs">
                {room.rtcServer.name} · {room.rtcServer.region}
              </span>
            ) : (
              <Dash />
            )}
          </KeyValue>
        </KeyValueGrid>
      </Card>

      <section>
        <SectionHeader title="Stats" subtitle="Derived from stored room and connection telemetry." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Participants" value={formatCount(room.participantCount)} />
          <StatCard
            label="Peak participants"
            value={formatCount(room.peakParticipants)}
            hint="Best-effort, from connection intervals"
          />
          <StatCard
            label="Duration"
            value={formatDuration(room.durationMs)}
            hint={room.endedAt ? 'Ended' : 'Ongoing'}
          />
          <StatCard
            label="Connection failures"
            value={formatCount(room.connectionFailures)}
            tone={room.connectionFailures > 0 ? 'danger' : 'default'}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Participants"
          subtitle={`${formatCount(room.participants.length)} participant(s) in this room.`}
        />

        {room.participants.length === 0 ? (
          <EmptyState
            title="No participants yet"
            description="A participant appears here as soon as an RTC token is issued for this room."
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Identity</TH>
                    <TH>Status</TH>
                    <TH>Connection</TH>
                    <TH>Joined</TH>
                    <TH>Left</TH>
                    <TH align="right">Duration</TH>
                    <TH align="right">Reconnects</TH>
                  </THead>
                  <TBody>
                    {room.participants.map((participant) => (
                      <ParticipantRow key={participant.id} participant={participant} />
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <div className="sm:hidden">
              <MobileList>
                {room.participants.map((participant) => (
                  <MobileRow key={participant.id} href={`/super-admin/rtc/participants/${participant.id}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{participant.identity}</span>
                      <ParticipantStatusBadge status={participant.status} />
                    </div>
                    <MobileField label="Joined">
                      {participant.joinedAt ? formatDateTime(participant.joinedAt) : <Dash />}
                    </MobileField>
                    <MobileField label="Left">
                      {participant.leftAt ? formatDateTime(participant.leftAt) : <Dash />}
                    </MobileField>
                    <MobileField label="Duration">{formatDuration(participant.durationMs)}</MobileField>
                    <MobileField label="Reconnects">{formatCount(participant.reconnectCount)}</MobileField>
                  </MobileRow>
                ))}
              </MobileList>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ParticipantRow({ participant }: { participant: RtcRoomParticipantSummary }) {
  return (
    <TR interactive>
      <TD>
        <a
          href={`/super-admin/rtc/participants/${participant.id}`}
          className="font-medium text-fg hover:text-accent-text hover:underline"
        >
          {participant.identity}
        </a>
      </TD>
      <TD>
        <ParticipantStatusBadge status={participant.status} />
      </TD>
      <TD>{participant.connectionState ? <ConnectionStateBadge state={participant.connectionState} /> : <Dash />}</TD>
      <TD>
        <span className="tabular text-xs text-muted">
          {participant.joinedAt ? formatDateTime(participant.joinedAt) : <Dash />}
        </span>
      </TD>
      <TD>
        <span className="tabular text-xs text-muted">
          {participant.leftAt ? formatDateTime(participant.leftAt) : <Dash />}
        </span>
      </TD>
      <TD align="right">
        <span className="tabular text-muted">{formatDuration(participant.durationMs)}</span>
      </TD>
      <TD align="right">
        <span className="tabular text-muted">{formatCount(participant.reconnectCount)}</span>
      </TD>
    </TR>
  );
}

function ParticipantStatusBadge({ status }: { status: RtcRoomParticipantSummary['status'] }) {
  if (status === 'JOINED') return <Badge tone="success">Joined</Badge>;
  if (status === 'LEFT') return <Badge tone="neutral">Left</Badge>;
  return <Badge tone="warning">Pending</Badge>;
}
