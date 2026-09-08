import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { ConnectionQualityBadge, ConnectionStateBadge, ErrorCategoryBadge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Timeline } from '@/components/ui/timeline';
import { KeyValue, KeyValueGrid, MonoId } from '@/components/ui/mono';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { formatBitrate, formatDateTime, formatDuration, formatMs, formatRelative } from '@/lib/format';

export default async function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; connectionId: string }>;
}) {
  const { projectId, connectionId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  let connection;
  try {
    connection = await ravenApi.getConnection(token, projectId, connectionId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="Connection not found"
          description="This connection either never existed under this project, or it has aged out of the retention window."
          action={
            <ButtonLink href={`${base}/connections`} variant="primary">
              All connections
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Unable to load this connection"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`${base}/connections/${connectionId}`}
      />
    );
  }

  const c = connection;
  // A connection that never reached CONNECTED has no meaningful "live"
  // duration: showing 0s would read as "connected instantly then died".
  const everConnected = Boolean(c.connectedAt);
  const isLive = c.state === 'CONNECTED' || c.state === 'RECONNECTING';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={{ label: 'All connections', href: `${base}/connections` }}
        title={<span className="font-mono text-lg">{c.publicId}</span>}
        meta={
          <>
            <ConnectionStateBadge state={c.state} />
            <CopyButton value={c.publicId} label="Copy ID" />
          </>
        }
        description={
          <>
            {c.participantIdentity} in{' '}
            {c.roomId ? (
              <a href={`${base}/rooms/${c.roomId}`} className="text-accent-text hover:underline">
                {c.roomName}
              </a>
            ) : (
              c.roomName
            )}
          </>
        }
      />

      {c.state === 'FAILED' && (
        <ErrorState
          title="This connection failed"
          description={
            c.disconnectReason
              ? `Reported reason: ${c.disconnectReason}`
              : 'No disconnect reason was reported. The timeline and any errors below are the best available evidence.'
          }
        />
      )}

      <Card>
        <CardHeader title="Overview" />
        <KeyValueGrid>
          <KeyValue label="Room">
            {c.roomId ? (
              <a href={`${base}/rooms/${c.roomId}`} className="text-accent-text hover:underline">
                {c.roomName}
              </a>
            ) : (
              c.roomName
            )}
          </KeyValue>
          <KeyValue label="Participant">
            <a
              href={`${base}/participants?q=${encodeURIComponent(c.participantIdentity)}`}
              className="text-accent-text hover:underline"
            >
              {c.participantIdentity}
            </a>
          </KeyValue>
          <KeyValue label="Started">
            <span title={c.startedAt}>{formatDateTime(c.startedAt)}</span>
          </KeyValue>
          <KeyValue label="Connected">
            {c.connectedAt ? <span title={c.connectedAt}>{formatDateTime(c.connectedAt)}</span> : <Dash />}
          </KeyValue>
          <KeyValue label="Disconnected">
            {c.disconnectedAt ? (
              <span title={c.disconnectedAt}>{formatDateTime(c.disconnectedAt)}</span>
            ) : isLive ? (
              <span className="text-success-text">Still connected</span>
            ) : (
              <Dash />
            )}
          </KeyValue>
          <KeyValue label="Duration">
            {c.durationMs !== null ? (
              formatDuration(c.durationMs)
            ) : isLive ? (
              <span className="text-muted">Open · started {formatRelative(c.startedAt)}</span>
            ) : (
              <Dash />
            )}
          </KeyValue>
          <KeyValue label="Region">{c.region ?? <Dash />}</KeyValue>
          <KeyValue label="SDK version" mono>
            {c.sdkVersion ?? <Dash />}
          </KeyValue>
          <KeyValue label="Platform">{c.platform ?? <Dash />}</KeyValue>
          <KeyValue label="Browser">{c.browser ?? <Dash />}</KeyValue>
          <KeyValue label="Network type">{c.networkType ?? <Dash />}</KeyValue>
          <KeyValue label="Disconnect reason">{c.disconnectReason ?? <Dash />}</KeyValue>
        </KeyValueGrid>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Timeline"
            subtitle="Every lifecycle event this connection reported, oldest first. Telemetry is best-effort, so gaps are possible."
          />
          {c.events.length === 0 ? (
            <NoDataYet label="No events were recorded for this connection" />
          ) : (
            <Timeline events={c.events} />
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Media quality"
              subtitle="Last stats sample from Room.getConnectionStats() — sent every 5s while connected."
              action={c.connectionQuality && <ConnectionQualityBadge quality={c.connectionQuality} />}
            />
            {c.rttMs === null && c.jitterMs === null && c.packetLossPercent === null ? (
              <NoDataYet label="No stats sample received yet for this connection" />
            ) : (
              <dl className="flex flex-col gap-3.5">
                <NetworkRow label="Round-trip time" value={formatMs(c.rttMs)} />
                <NetworkRow label="Jitter (worst track)" value={formatMs(c.jitterMs)} />
                <NetworkRow
                  label="Packet loss (worst track)"
                  value={c.packetLossPercent === null ? null : `${c.packetLossPercent}%`}
                />
                <NetworkRow label="Bitrate (send + receive)" value={formatBitrate(c.bitrateBps)} />
                <NetworkRow label="Codec" value={c.codec} />
              </dl>
            )}
          </Card>

          <Card>
            <CardHeader title="Transport" subtitle="Last reported connection-level state." />
            <dl className="flex flex-col gap-3.5">
              <NetworkRow label="ICE connection state" value={c.iceConnectionState} />
              <NetworkRow label="Signaling state" value={c.signalingState} />
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs font-medium text-muted">Reconnect count</dt>
                <dd
                  className={`tabular text-sm font-medium ${
                    c.reconnectCount > 0 ? 'text-warning-text' : 'text-fg'
                  }`}
                >
                  {c.reconnectCount}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs font-medium text-muted">Reached connected</dt>
                <dd className={`text-sm font-medium ${everConnected ? 'text-success-text' : 'text-danger-text'}`}>
                  {everConnected ? 'Yes' : 'No'}
                </dd>
              </div>
            </dl>
            {!c.iceConnectionState && !c.signalingState && (
              <p className="mt-4 border-t border-line pt-3 text-xs text-subtle">
                ICE and signaling state are only recorded when the SDK reports them; the current browser SDK does not
                yet emit these, so they are usually empty.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Errors"
              subtitle={c.errors.length > 0 ? `${c.errors.length} recorded on this connection.` : undefined}
            />
            {c.errors.length === 0 ? (
              <p className="text-sm text-muted">No connection errors detected.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {c.errors.map((error) => (
                  <li key={error.publicId} className="rounded-md border border-line bg-surface-sunken p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ErrorCategoryBadge category={error.category} />
                      <MonoId value={error.publicId} href={`${base}/errors/${error.publicId}`} />
                      <span className="tabular ml-auto text-xs text-subtle">{formatRelative(error.timestamp)}</span>
                    </div>
                    <p className="mt-2 text-sm text-fg">{error.message}</p>
                    {error.suggestedAction && (
                      <p className="mt-1.5 text-xs leading-relaxed text-muted">
                        <span className="font-medium text-fg">Try: </span>
                        {error.suggestedAction}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function NetworkRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="truncate font-mono text-xs text-fg">{value ?? <Dash />}</dd>
    </div>
  );
}
