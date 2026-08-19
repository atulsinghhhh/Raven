import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { ConnectionStateBadge } from '@/components/ui/badge';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { IconConnections } from '@/components/ui/icons';
import { formatCount, formatDuration, formatRelative } from '@/lib/format';

const SCAN_LIMIT = 200;

/**
 * Chat WebSocket sessions — one row per socket, not one per state change.
 * Presence is deliberately not here: it lives in Redis with a TTL and
 * would be meaningless as a durable record (spec §20).
 *
 * `Gateway` is the column that matters when something goes wrong in a
 * multi-instance deployment: it names the process that was holding the
 * socket.
 */
export default async function ChatConnectionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  let connections;
  try {
    connections = await ravenApi.listChatConnections(token, projectId, { limit: SCAN_LIMIT });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Unable to load chat connections"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`${base}/chat/connections`}
      />
    );
  }

  if (connections.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Chat connections" description="WebSocket sessions against the chat gateway." />
        <EmptyState
          icon={<IconConnections className="size-7" />}
          title="No chat connections yet"
          description="A record appears the moment a client calls connect() with @corvidhq/chat. Recording is automatic — nothing to instrument."
          action={
            <ButtonLink href={`${base}/chat`} variant="secondary">
              Chat overview
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const live = connections.filter((c) => c.state === 'CONNECTED' || c.state === 'RECONNECTING').length;
  const withDuration = connections.filter((c) => c.durationMs !== null);
  const averageDuration =
    withDuration.length > 0
      ? Math.round(withDuration.reduce((sum, c) => sum + (c.durationMs ?? 0), 0) / withDuration.length)
      : null;
  const gateways = new Set(connections.map((c) => c.gatewayId));
  const totalMessages = connections.reduce((sum, c) => sum + c.messagesSent, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Chat connections"
        description="Every chat WebSocket session, newest first. Separate from RTC connections — a user may hold both at once."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Records shown" value={formatCount(connections.length)} hint={`Most recent ${SCAN_LIMIT} max`} />
        <StatCard label="Currently live" value={formatCount(live)} hint="Connected or reconnecting" />
        <StatCard label="Messages sent" value={formatCount(totalMessages)} hint="Across these sessions" />
        <StatCard
          label="Avg. session"
          value={averageDuration === null ? <NoDataYet label="None closed" /> : formatDuration(averageDuration)}
          hint={`${withDuration.length} closed`}
        />
      </div>

      {gateways.size > 1 && (
        <section>
          <SectionHeader
            title="Gateway distribution"
            subtitle="These sessions were spread across several gateway instances — which is what horizontal scaling looks like from here."
          />
          <div className="flex flex-wrap gap-2">
            {Array.from(gateways).map((gatewayId) => (
              <span key={gatewayId} className="rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-xs text-muted">
                {gatewayId}
                <span className="ml-2 tabular text-subtle">
                  {connections.filter((c) => c.gatewayId === gatewayId).length}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <TableWrap className="hidden sm:block">
        <Table>
          <THead>
            <TH>Connection</TH>
            <TH>User</TH>
            <TH>Status</TH>
            <TH>Gateway</TH>
            <TH align="right">Messages</TH>
            <TH align="right">Duration</TH>
            <TH>SDK</TH>
            <TH align="right">Started</TH>
          </THead>
          <TBody>
            {connections.map((connection) => (
              <TR key={connection.publicId}>
                <TD className="max-w-[13rem]">
                  <span className="block truncate font-mono text-xs text-fg" title={connection.publicId}>
                    {connection.publicId}
                  </span>
                </TD>
                <TD className="max-w-[10rem]">
                  <span className="block truncate text-sm text-muted" title={connection.userId}>
                    {connection.userId}
                  </span>
                </TD>
                <TD>
                  <ConnectionStateBadge state={connection.state} />
                </TD>
                <TD className="max-w-[9rem]">
                  <span className="block truncate font-mono text-[0.6875rem] text-subtle" title={connection.gatewayId}>
                    {connection.gatewayId}
                  </span>
                </TD>
                <TD align="right" className="tabular text-sm text-muted">
                  {formatCount(connection.messagesSent)}
                </TD>
                <TD align="right" className="tabular text-sm text-muted">
                  {formatDuration(connection.durationMs)}
                </TD>
                <TD className="text-sm text-muted">
                  {connection.sdkVersion ? <span className="font-mono text-xs">{connection.sdkVersion}</span> : <Dash />}
                </TD>
                <TD align="right" className="tabular text-xs text-subtle">
                  <span title={new Date(connection.createdAt).toISOString()}>{formatRelative(connection.createdAt)}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <div className="sm:hidden">
        <MobileList>
          {connections.map((connection) => (
            <MobileRow key={connection.publicId}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{connection.userId}</span>
                  <span className="block truncate font-mono text-[0.6875rem] text-subtle">{connection.publicId}</span>
                </span>
                <ConnectionStateBadge state={connection.state} />
              </div>
              <div className="mt-3 border-t border-line pt-2">
                <MobileField label="Gateway">
                  <span className="font-mono text-[0.6875rem]">{connection.gatewayId}</span>
                </MobileField>
                <MobileField label="Messages">{formatCount(connection.messagesSent)}</MobileField>
                <MobileField label="Duration">{formatDuration(connection.durationMs)}</MobileField>
              </div>
            </MobileRow>
          ))}
        </MobileList>
      </div>
    </div>
  );
}
