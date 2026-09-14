import { redirect } from 'next/navigation';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { IconServer } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatPercent, formatRelative } from '@/lib/format';
import { getSessionToken } from '@/lib/session';
import { getInfrastructure, type InfrastructureOverview } from '@/lib/super-admin/ops';
import { ApiError } from '@/lib/super-admin-client';

/**
 * Infrastructure surface (spec §17): the same dependency probes
 * `GET /health/ready` runs, plus per-node RTC fleet detail from
 * `RtcServer`. Load figures are a snapshot from each node's last
 * heartbeat, not live truth — shown alongside `lastHeartbeatAt`, same
 * caveat the existing `/v1/rtc/servers` dashboard endpoint documents.
 */

const NODE_STATUS_TONE = { HEALTHY: 'success', DRAINING: 'warning', UNHEALTHY: 'danger' } as const;

export default async function SuperAdminInfrastructurePage() {
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/infrastructure');

  let data: InfrastructureOverview | null = null;
  let loadError: ApiError | null = null;

  try {
    data = await getInfrastructure(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?next=/super-admin/infrastructure');
    if (err instanceof ApiError) {
      loadError = err;
    } else {
      throw err;
    }
  }

  const base = '/super-admin/infrastructure';

  if (loadError) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Infrastructure" eyebrow="Operations" />
        {loadError.status === 403 ? (
          <EmptyState
            title="You don't have access to Infrastructure"
            description="Reading platform infrastructure health requires Super Admin Portal access."
            icon={<IconServer className="size-6" />}
          />
        ) : (
          <ErrorState title="Could not load infrastructure status" description="The Control API is unreachable right now. Retry in a moment." retryHref={base} />
        )}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Infrastructure"
        eyebrow="Operations"
        description="Dependency health and RTC fleet detail. The dependency probes are the same checks GET /health/ready runs — this page is a second reader, not a second implementation."
      />

      <section>
        <SectionHeader title="Dependencies" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <DependencyCard label="API" status="up" />
          <DependencyCard label="Database" status={data.dependencies.database} />
          <DependencyCard label="Redis" status={data.dependencies.redis} />
          <DependencyCard label="SFU" status={data.dependencies.sfu} />
          <DependencyCard label="TURN" status={data.dependencies.turn} />
        </div>
      </section>

      <section>
        <SectionHeader title="RTC fleet" subtitle="Aggregate totals across every registered node." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Servers" value={formatCount(data.fleet.servers)} hint={`${formatCount(data.fleet.healthyServers)} healthy`} />
          <StatCard label="Draining" value={formatCount(data.fleet.drainingServers)} />
          <StatCard label="Unhealthy" value={formatCount(data.fleet.unhealthyServers)} tone={data.fleet.unhealthyServers > 0 ? 'danger' : 'default'} />
          <StatCard label="Active rooms" value={formatCount(data.fleet.activeRooms)} hint={`${formatCount(data.fleet.activeParticipants)} participants`} />
        </div>
      </section>

      <section>
        <SectionHeader title="Nodes" subtitle="One row per registered RTC server." />

        {data.nodes.length === 0 ? (
          <EmptyState title="No RTC servers registered" description="No SFU node has registered with the fleet yet." icon={<IconServer className="size-6" />} />
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>Node</TH>
                  <TH>Region</TH>
                  <TH align="right">Status</TH>
                  <TH align="right">Rooms</TH>
                  <TH align="right">Participants</TH>
                  <TH align="right">CPU</TH>
                  <TH align="right">Memory</TH>
                  <TH>Last heartbeat</TH>
                </THead>
                <TBody>
                  {data.nodes.map((node) => (
                    <TR key={node.id}>
                      <TD>
                        <span className="text-sm text-fg">{node.name}</span>
                        <div className="font-mono text-[11px] text-subtle">{node.internalUrl}</div>
                      </TD>
                      <TD>
                        <span className="text-xs text-muted">{node.region}</span>
                      </TD>
                      <TD align="right">
                        <Badge tone={NODE_STATUS_TONE[node.status]}>{node.status}</Badge>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-fg">
                          {formatCount(node.activeRooms)}/{formatCount(node.capacity)}
                        </span>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-fg">{formatCount(node.activeParticipants)}</span>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-muted">{formatPercent(node.cpuPercent) ?? <NoDataYet label="—" />}</span>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-muted">{formatPercent(node.memoryPercent) ?? <NoDataYet label="—" />}</span>
                      </TD>
                      <TD>
                        {node.lastHeartbeatAt ? (
                          <span className="text-xs text-subtle">{formatRelative(node.lastHeartbeatAt)}</span>
                        ) : (
                          <Dash />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="sm:hidden">
              <MobileList>
                {data.nodes.map((node) => (
                  <MobileRow key={node.id}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="text-sm font-medium text-fg">{node.name}</span>
                      <Badge tone={NODE_STATUS_TONE[node.status]}>{node.status}</Badge>
                    </div>
                    <MobileField label="Region">{node.region}</MobileField>
                    <MobileField label="Rooms">
                      {formatCount(node.activeRooms)}/{formatCount(node.capacity)}
                    </MobileField>
                    <MobileField label="Participants">{formatCount(node.activeParticipants)}</MobileField>
                    <MobileField label="CPU">{formatPercent(node.cpuPercent) ?? '—'}</MobileField>
                    <MobileField label="Last heartbeat">
                      {node.lastHeartbeatAt ? formatRelative(node.lastHeartbeatAt) : '—'}
                    </MobileField>
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

function DependencyCard({ label, status }: { label: string; status: 'up' | 'down' }) {
  return (
    <Card>
      <div className="mono-label text-[11px] text-muted">{label}</div>
      <div className="mt-2">
        <StatusBadge status={status} />
      </div>
    </Card>
  );
}
