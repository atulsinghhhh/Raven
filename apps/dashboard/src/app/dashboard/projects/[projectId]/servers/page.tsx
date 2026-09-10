import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ProductTabs, rtcTabs } from '@/components/shell/product-tabs';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { IconRooms } from '@/components/ui/icons';
import { formatCount, formatPercent } from '@/lib/format';
import { FleetTable } from './fleet-table';

/**
 * The RTC media plane's fleet (spec §29 "Servers", §37).
 *
 * # Why this page is project-scoped in the URL but not in the data
 *
 * An SFU node is deployment-level infrastructure shared by every project,
 * so the Control API's endpoint is not project-scoped and there is no
 * project whose membership could authorize it. The page lives under a
 * project anyway because that is where a developer already is when they
 * ask "why is my call not connecting", and the answer is sometimes "no
 * healthy node has capacity", which no project-scoped page could tell
 * them. It exposes only node identity, health and aggregate load, never
 * anything about another project's rooms.
 *
 * # What an operator can actually conclude here
 *
 * Load figures are each node's last heartbeat, not live truth. What the
 * page is genuinely authoritative about is *allocation eligibility*:
 * which nodes the allocator will and will not choose right now. That is
 * the fact behind `NO_RTC_CAPACITY`, and it is what the status column
 * means.
 */
export default async function ServersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  // The fleet list is load-bearing; the aggregate metrics are a
  // convenience over the same rows, so they degrade on their own rather
  // than taking the page down.
  const [serversResult, metricsResult] = await Promise.allSettled([
    ravenApi.listRtcServers(token),
    ravenApi.getRtcFleetMetrics(token),
  ]);

  if (serversResult.status === 'rejected') {
    const reason = serversResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Could not load the RTC fleet"
        description="The Control API is unreachable right now. Calls already in progress are unaffected — media does not flow through the control plane."
        retryHref={`/dashboard/projects/${projectId}/servers`}
      />
    );
  }

  const servers = serversResult.value;
  const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : undefined;
  const base = `/dashboard/projects/${projectId}`;

  // Derived from the rows, not read from `metrics`, so the headline
  // number and the table can never disagree in front of an operator.
  const allocatable = servers.filter((server) => server.status === 'HEALTHY');
  const headroom = allocatable.reduce((sum, s) => sum + Math.max(0, s.capacity - s.activeRooms), 0);
  const regions = new Set(servers.map((server) => server.region));
  const utilisation =
    metrics && metrics.capacity > 0 ? formatPercent((metrics.activeRooms / metrics.capacity) * 100) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="RTC servers"
        description="The SFU nodes serving this deployment's media. Nodes register themselves on boot and heartbeat; nothing here is provisioned by hand."
        actions={
          <ButtonLink href={`${base}/diagnostics`} variant="secondary">
            Diagnostics
          </ButtonLink>
        }
      />
      <ProductTabs tabs={rtcTabs(base)} active="Servers" />

      {servers.length === 0 ? (
        <EmptyState
          icon={<IconRooms className="size-7" />}
          title="No RTC servers registered"
          description={
            <>
              No SFU has registered with this deployment, so <strong>every join will fail</strong> with{' '}
              <code className="font-mono text-xs text-fg">RAVEN_NO_RTC_CAPACITY</code>. A node registers itself on boot
              — it needs <code className="font-mono text-xs text-fg">SFU_CONTROL_PLANE_URL</code> pointing at this API
              and a matching <code className="font-mono text-xs text-fg">SFU_REGISTRATION_SECRET</code>. Locally that is{' '}
              <code className="font-mono text-xs text-fg">docker compose up -d sfu</code>.
            </>
          }
          action={
            <ButtonLink href={`${base}/diagnostics`} variant="primary">
              Check dependencies
            </ButtonLink>
          }
        />
      ) : (
        <>
          <section>
            <SectionHeader
              title="Fleet"
              subtitle="Counts are aggregated from each node's last heartbeat. Status is live — it is what the allocator reads."
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Allocatable nodes"
                value={formatCount(allocatable.length)}
                hint={
                  allocatable.length === servers.length
                    ? `All ${formatCount(servers.length)} registered`
                    : `${formatCount(servers.length - allocatable.length)} draining or not answering`
                }
                tone={allocatable.length === 0 ? 'danger' : 'default'}
              />
              <StatCard
                label="Room headroom"
                value={formatCount(headroom)}
                hint="Advertised capacity left on allocatable nodes"
                tone={headroom === 0 ? 'danger' : headroom < 5 ? 'warning' : 'default'}
              />
              <StatCard
                label="Rooms being served"
                value={metrics ? formatCount(metrics.activeRooms) : <NoDataYet label="Unknown" />}
                hint={utilisation ? `${utilisation} of advertised capacity` : 'Rooms with a live media session'}
              />
              <StatCard
                label="Participants"
                value={metrics ? formatCount(metrics.activeParticipants) : <NoDataYet label="Unknown" />}
                hint={`Across ${formatCount(regions.size)} region${regions.size === 1 ? '' : 's'}`}
              />
            </div>
          </section>

          <section>
            <SectionHeader
              title="Nodes"
              subtitle="Draining takes a node out of the allocation pool. Calls already on it keep running and drain as they end."
            />
            <FleetTable initialServers={servers} />
          </section>

          <section>
            <SectionHeader title="Reading this page" />
            <div className="rounded-lg border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
              <p>
                <strong className="text-fg">Status is the only live column.</strong> Rooms, participants, CPU and memory
                are whatever the node last reported, which is why the heartbeat age sits beside them —{' '}
                <code className="font-mono text-xs">0 rooms</code> from a node that last spoke four minutes ago means
                something different from the same figure reported two seconds ago. A blank figure means the node did not
                report it, never that it is zero.
              </p>
              <p className="mt-3">
                <strong className="text-fg">Clients are never told a node&rsquo;s address.</strong> A join learns the
                node&rsquo;s <em>name</em>, for support and for this page. That is what lets the media plane be
                re-shaped, re-scaled or replaced without an SDK release, and it is why{' '}
                <code className="font-mono text-xs">internalUrl</code> is not shown here.
              </p>
              <p className="mt-3">
                Capacity is a ceiling each node advertises for itself, not a measured limit. Livqeno does not publish a
                supported participant count for this release — see the RTC scaling docs for what was actually measured.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
