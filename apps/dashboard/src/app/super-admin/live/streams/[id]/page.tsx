import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { getLiveStream, type LiveStreamDetail, type LiveStreamEgressStatus } from '@/lib/super-admin/live';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { KeyValue, KeyValueGrid } from '@/components/ui/mono';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatDuration } from '@/lib/format';

/**
 * One live stream, in full, for a Raven operator (spec §12): who's
 * streaming, in what project, its hosts/co-hosts, its egress pipeline if
 * it's a BROADCAST-mode stream, its linked chat conversation, and the RTC
 * region its room is pinned to if one was assigned.
 */
export default async function SuperAdminLiveStreamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = await getSessionToken();
  if (!token) redirect(`/login?next=/super-admin/live/streams/${encodeURIComponent(id)}`);

  let stream: LiveStreamDetail;
  try {
    stream = await getLiveStream(token, id);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) redirect('/dashboard');
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="Live stream not found"
          description="This stream may not exist, or its id was mistyped."
          action={
            <ButtonLink href="/super-admin/live" variant="primary">
              Back to Live Streaming
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Unable to load this stream"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`/super-admin/live/streams/${encodeURIComponent(id)}`}
      />
    );
  }

  const durationMs =
    stream.startedAt && stream.endedAt
      ? new Date(stream.endedAt).getTime() - new Date(stream.startedAt).getTime()
      : null;
  const activeHostCount = stream.hosts.filter((h) => h.removedAt === null).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        breadcrumb={{ label: 'Live Streaming', href: '/super-admin/live' }}
        title={stream.title}
        eyebrow={stream.projectName}
        description={stream.description ?? undefined}
        meta={<StreamStatusBadge status={stream.status} />}
      />

      <Card>
        <CardHeader title="Stream" eyebrow="Overview" />
        <KeyValueGrid>
          <KeyValue label="Stream id" mono>
            {stream.id}
          </KeyValue>
          <KeyValue label="Project">{stream.projectName}</KeyValue>
          <KeyValue label="Developer">{stream.ownerEmail}</KeyValue>
          <KeyValue label="Environment">{stream.environment}</KeyValue>
          <KeyValue label="Visibility">{stream.visibility}</KeyValue>
          <KeyValue label="Delivery mode">
            <Badge tone={stream.deliveryMode === 'BROADCAST' ? 'accent' : 'neutral'}>{stream.deliveryMode}</Badge>
          </KeyValue>
          <KeyValue label="Category">{stream.category ?? <Dash />}</KeyValue>
          <KeyValue label="Language">{stream.language ?? <Dash />}</KeyValue>
          <KeyValue label="Created">{formatDateTime(stream.createdAt)}</KeyValue>
          <KeyValue label="Scheduled">{stream.scheduledAt ? formatDateTime(stream.scheduledAt) : <Dash />}</KeyValue>
          <KeyValue label="Started">{stream.startedAt ? formatDateTime(stream.startedAt) : <Dash />}</KeyValue>
          <KeyValue label="Ended">{stream.endedAt ? formatDateTime(stream.endedAt) : <Dash />}</KeyValue>
        </KeyValueGrid>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Peak viewers"
          value={formatCount(stream.peakViewerCount)}
          hint="Highest recorded, this stream"
        />
        <StatCard
          label="Duration"
          value={durationMs === null ? <Dash /> : formatDuration(durationMs)}
          hint={durationMs === null ? 'Stream has not ended' : 'Started to ended'}
        />
        <StatCard
          label="Hosts"
          value={formatCount(activeHostCount)}
          hint={`${formatCount(stream.hosts.length)} total, including removed`}
        />
      </div>

      <section>
        <SectionHeader title="Hosts and co-hosts" subtitle="Every identity registered on this stream, invited first." />
        {stream.hosts.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No hosts have been registered on this stream.</p>
          </Card>
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Identity</TH>
                    <TH>Role</TH>
                    <TH>Invited</TH>
                    <TH>Removed</TH>
                  </THead>
                  <TBody>
                    {stream.hosts.map((host) => (
                      <TR key={host.id}>
                        <TD>
                          <span className="font-mono text-xs text-fg">{host.identity}</span>
                        </TD>
                        <TD>
                          <Badge tone={host.role === 'HOST' ? 'accent' : 'neutral'}>
                            {host.role.replace('_', '-')}
                          </Badge>
                        </TD>
                        <TD>
                          <span className="tabular text-xs text-muted">{formatDateTime(host.invitedAt)}</span>
                        </TD>
                        <TD>
                          {host.removedAt ? (
                            <span className="tabular text-xs text-muted">{formatDateTime(host.removedAt)}</span>
                          ) : (
                            <Badge tone="success">Active</Badge>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>
            <div className="sm:hidden">
              <MobileList>
                {stream.hosts.map((host) => (
                  <MobileRow key={host.id}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs text-fg">{host.identity}</span>
                      <Badge tone={host.role === 'HOST' ? 'accent' : 'neutral'}>{host.role.replace('_', '-')}</Badge>
                    </div>
                    <MobileField label="Invited">{formatDateTime(host.invitedAt)}</MobileField>
                    <MobileField label="Removed">
                      {host.removedAt ? formatDateTime(host.removedAt) : <Dash />}
                    </MobileField>
                  </MobileRow>
                ))}
              </MobileList>
            </div>
          </>
        )}
      </section>

      {stream.deliveryMode === 'BROADCAST' && (
        <section>
          <SectionHeader title="Egress" subtitle="The HLS broadcast pipeline for this stream." />
          <Card>
            {stream.egress ? (
              <KeyValueGrid>
                <KeyValue label="Status">
                  <EgressStatusBadge status={stream.egress.status} />
                </KeyValue>
                <KeyValue label="Worker id" mono>
                  {stream.egress.workerId ?? <Dash />}
                </KeyValue>
                <KeyValue label="Playback URL" mono>
                  {/* Text only, deliberately not a clickable link — this may be a live
                      broadcast URL, and this console never turns operational data into
                      a one-click way to open someone else's stream. */}
                  {stream.egress.playbackUrl ?? <Dash />}
                </KeyValue>
                <KeyValue label="HLS ready">
                  {stream.egress.hlsReadyAt ? formatDateTime(stream.egress.hlsReadyAt) : <Dash />}
                </KeyValue>
                <KeyValue label="Last segment">
                  {stream.egress.lastSegmentAt ? formatDateTime(stream.egress.lastSegmentAt) : <Dash />}
                </KeyValue>
                <KeyValue label="Started">
                  {stream.egress.startedAt ? formatDateTime(stream.egress.startedAt) : <Dash />}
                </KeyValue>
                <KeyValue label="Stopped">
                  {stream.egress.stoppedAt ? formatDateTime(stream.egress.stoppedAt) : <Dash />}
                </KeyValue>
                <KeyValue label="Last error">{stream.egress.lastError ?? <Dash />}</KeyValue>
              </KeyValueGrid>
            ) : (
              <p className="text-sm text-muted">
                BROADCAST mode is set on this stream, but no egress worker run has been recorded yet.
              </p>
            )}
          </Card>
        </section>
      )}

      <section>
        <SectionHeader title="Room and chat" subtitle="What this stream is built on." />
        <Card>
          <KeyValueGrid>
            <KeyValue label="Room" mono>
              {stream.room?.name ?? <Dash />}
            </KeyValue>
            <KeyValue label="Room status">{stream.room?.status ?? <Dash />}</KeyValue>
            <KeyValue label="RTC region">{stream.room?.region ?? <Dash />}</KeyValue>
            <KeyValue label="Chat conversation">
              {stream.conversationId ? (
                <a
                  href={`/super-admin/chat/conversations/${encodeURIComponent(stream.conversationId)}`}
                  className="text-accent-text hover:underline"
                >
                  {stream.conversationId}
                </a>
              ) : (
                <Dash />
              )}
            </KeyValue>
          </KeyValueGrid>
        </Card>
      </section>
    </div>
  );
}

function statusTone(status: LiveStreamDetail['status']): BadgeTone {
  if (status === 'LIVE') return 'live';
  if (status === 'ENDED') return 'neutral';
  if (status === 'CREATED') return 'info';
  return 'warning';
}

function StreamStatusBadge({ status }: { status: LiveStreamDetail['status'] }) {
  return <Badge tone={statusTone(status)}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

const EGRESS_TONE: Record<LiveStreamEgressStatus, BadgeTone> = {
  NOT_STARTED: 'neutral',
  STARTING: 'warning',
  RUNNING: 'success',
  STOPPING: 'warning',
  STOPPED: 'neutral',
  FAILED: 'danger',
};

function EgressStatusBadge({ status }: { status: LiveStreamEgressStatus }) {
  return <Badge tone={EGRESS_TONE[status] ?? 'neutral'}>{status.replace('_', ' ')}</Badge>;
}
