import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { getRtcParticipant, type RtcParticipantConnection } from '@/lib/super-admin/rtc';
import { Badge, ConnectionStateBadge } from '@/components/ui/badge';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { KeyValue, KeyValueGrid, MonoId } from '@/components/ui/mono';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatDuration, formatMs } from '@/lib/format';

export default async function SuperAdminRtcParticipantPage({
  params,
}: {
  params: Promise<{ participantId: string }>;
}) {
  const { participantId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/rtc');

  let participant;
  try {
    participant = await getRtcParticipant(token, participantId);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) redirect('/dashboard');
    if (err instanceof ApiError && err.status === 404) {
      return (
        <EmptyState
          title="Participant not found"
          description="This participant may not exist, or its id was mistyped."
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
        title="Could not load this participant"
        description="The API is unreachable right now. Retry in a moment."
        retryHref={`/super-admin/rtc/participants/${participantId}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={participant.identity}
        eyebrow="Super Admin · RTC"
        breadcrumb={{ label: participant.room.name, href: `/super-admin/rtc/rooms/${participant.room.id}` }}
        description={`${participant.room.projectName} — owned by ${participant.room.developerEmail}`}
        meta={<ParticipantStatusBadge status={participant.status} />}
      />

      <Card>
        <CardHeader title="Participant" subtitle="Identity and room membership." />
        <KeyValueGrid>
          <KeyValue label="Participant ID">
            <MonoId value={participant.id} copy />
          </KeyValue>
          <KeyValue label="Room">
            <a
              href={`/super-admin/rtc/rooms/${participant.room.id}`}
              className="text-accent-text hover:underline"
            >
              {participant.room.name}
            </a>
          </KeyValue>
          <KeyValue label="Project">{participant.room.projectName}</KeyValue>
          <KeyValue label="Developer">{participant.room.developerEmail}</KeyValue>
          <KeyValue label="Joined">
            <span className="tabular">{participant.joinedAt ? formatDateTime(participant.joinedAt) : <Dash />}</span>
          </KeyValue>
          <KeyValue label="Left">
            <span className="tabular">{participant.leftAt ? formatDateTime(participant.leftAt) : <Dash />}</span>
          </KeyValue>
          <KeyValue label="Duration">{formatDuration(participant.durationMs)}</KeyValue>
          <KeyValue label="Reconnects">{formatCount(participant.reconnectCount)}</KeyValue>
        </KeyValueGrid>
      </Card>

      <section>
        <SectionHeader title="Connection state" subtitle="From this participant's most recent connection record." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="State"
            value={participant.connectionState ? <ConnectionStateBadge state={participant.connectionState} /> : <Dash />}
          />
          <StatCard label="RTT" value={formatMs(participant.networkQuality.rttMs) ?? <Dash />} hint="Send direction" />
          <StatCard label="Jitter" value={formatMs(participant.networkQuality.jitterMs) ?? <Dash />} />
          <StatCard
            label="Packet loss"
            value={participant.networkQuality.packetLossPercent === null ? <Dash /> : `${participant.networkQuality.packetLossPercent}%`}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Connection history"
          subtitle={`${formatCount(participant.connections.length)} connection record(s) for this participant in this room.`}
        />

        {participant.connections.length === 0 ? (
          <EmptyState title="No connection records" description="No telemetry has been recorded for this participant yet." />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Connection</TH>
                    <TH>State</TH>
                    <TH>Region</TH>
                    <TH align="right">Duration</TH>
                    <TH align="right">Reconnects</TH>
                    <TH>Started</TH>
                    <TH>Ended</TH>
                  </THead>
                  <TBody>
                    {participant.connections.map((connection) => (
                      <ConnectionRow key={connection.id} connection={connection} />
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <div className="sm:hidden">
              <MobileList>
                {participant.connections.map((connection) => (
                  <MobileRow key={connection.id}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs text-fg">{connection.id}</span>
                      <ConnectionStateBadge state={connection.state} />
                    </div>
                    <MobileField label="Started">{formatDateTime(connection.startedAt)}</MobileField>
                    <MobileField label="Ended">{connection.disconnectedAt ? formatDateTime(connection.disconnectedAt) : <Dash />}</MobileField>
                    <MobileField label="Duration">{formatDuration(connection.durationMs)}</MobileField>
                    <MobileField label="Reconnects">{formatCount(connection.reconnectCount)}</MobileField>
                  </MobileRow>
                ))}
              </MobileList>
            </div>
          </>
        )}
      </section>

      <section>
        <SectionHeader
          title="RTC tokens"
          subtitle={`${formatCount(participant.rtcTokens.length)} token(s) issued for this participant. Permissions only — the signed credential itself is never persisted.`}
        />
        {participant.rtcTokens.length === 0 ? (
          <EmptyState title="No RTC tokens" description="No token has been issued for this participant yet." />
        ) : (
          <div className="hidden sm:block">
            <TableWrap>
              <Table>
                <THead>
                  <TH>Token ID</TH>
                  <TH>Permissions</TH>
                  <TH>Issued</TH>
                  <TH>Expires</TH>
                </THead>
                <TBody>
                  {participant.rtcTokens.map((token) => (
                    <TR key={token.id}>
                      <TD>
                        <MonoId value={token.id} />
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-muted">{JSON.stringify(token.permissions)}</span>
                      </TD>
                      <TD>
                        <span className="tabular text-xs text-muted">{formatDateTime(token.createdAt)}</span>
                      </TD>
                      <TD>
                        <span className="tabular text-xs text-muted">{formatDateTime(token.expiresAt)}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </div>
        )}
      </section>
    </div>
  );
}

function ConnectionRow({ connection }: { connection: RtcParticipantConnection }) {
  return (
    <TR>
      <TD>
        <MonoId value={connection.id} />
      </TD>
      <TD>
        <ConnectionStateBadge state={connection.state} />
      </TD>
      <TD className="text-sm text-muted">{connection.region ?? <Dash />}</TD>
      <TD align="right">
        <span className="tabular text-muted">{formatDuration(connection.durationMs)}</span>
      </TD>
      <TD align="right">
        <span className="tabular text-muted">{formatCount(connection.reconnectCount)}</span>
      </TD>
      <TD>
        <span className="tabular text-xs text-muted">{formatDateTime(connection.startedAt)}</span>
      </TD>
      <TD>
        <span className="tabular text-xs text-muted">{connection.disconnectedAt ? formatDateTime(connection.disconnectedAt) : <Dash />}</span>
      </TD>
    </TR>
  );
}

function ParticipantStatusBadge({ status }: { status: 'PENDING' | 'JOINED' | 'LEFT' }) {
  if (status === 'JOINED') return <Badge tone="success">Joined</Badge>;
  if (status === 'LEFT') return <Badge tone="neutral">Left</Badge>;
  return <Badge tone="warning">Pending</Badge>;
}
