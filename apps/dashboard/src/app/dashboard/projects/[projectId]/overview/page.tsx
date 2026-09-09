import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi, type RtcFleetMetrics } from '@/lib/api-client';
import { Badge, ConnectionStateBadge, ErrorCategoryBadge, StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { PageHeader } from '@/components/ui/page-header';
import { RangeSelector } from '@/components/ui/range-selector';
import { RateBar } from '@/components/ui/chart';
import { MonoId } from '@/components/ui/mono';
import { Dash, ErrorState, NoDataYet } from '@/components/ui/states';
import { IconChevronRight } from '@/components/ui/icons';
import { formatCount, formatDuration, formatRelative, normaliseRange, RANGE_LABEL } from '@/lib/format';
import { buildOnboardingSteps } from '@/lib/onboarding';
import { OnboardingProgress } from '@/components/onboarding-progress';

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { projectId } = await params;
  const range = normaliseRange((await searchParams).range);

  const token = await getSessionToken();
  if (!token) redirect('/login');

  // Every panel degrades on its own. One unreachable dependency shouldn't
  // blank the page a developer opened *because* something looked wrong.
  const [
    projectResult,
    metricsResult,
    diagnosticsResult,
    connectionsResult,
    errorsResult,
    roomsResult,
    apiKeysResult,
    chatOverviewResult,
    liveStreamsResult,
    rtcFleetResult,
  ] = await Promise.allSettled([
    ravenApi.getProject(token, projectId),
    ravenApi.getMetrics(token, projectId, range),
    ravenApi.getDiagnostics(token, projectId),
    ravenApi.listConnections(token, projectId, { limit: 8 }),
    ravenApi.listErrors(token, projectId, { limit: 5 }),
    ravenApi.listRooms(token, projectId),
    ravenApi.listApiKeys(token, projectId),
    ravenApi.getChatOverview(token, projectId, range),
    ravenApi.listLiveStreams(token, projectId),
    // Deployment-level, not project-scoped. Included because `sfu: up`
    // alone cannot answer the question a developer actually has when
    // calls are failing: a probed node can answer while every node is
    // draining, and then no room can be allocated at all.
    ravenApi.getRtcFleetMetrics(token),
  ]);

  if (projectResult.status === 'rejected') {
    if (projectResult.reason instanceof ApiError && projectResult.reason.status === 401) redirect('/login');
    return <ErrorState title="Could not load this project" description="The Control API is unreachable right now." />;
  }

  const project = projectResult.value;
  const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : undefined;
  const diagnostics = diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : undefined;
  const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value : [];
  const errors = errorsResult.status === 'fulfilled' ? errorsResult.value : [];
  const rooms = roomsResult.status === 'fulfilled' ? roomsResult.value : undefined;
  const apiKeys = apiKeysResult.status === 'fulfilled' ? apiKeysResult.value : [];
  const chatOverview = chatOverviewResult.status === 'fulfilled' ? chatOverviewResult.value : undefined;
  const liveStreams = liveStreamsResult.status === 'fulfilled' ? liveStreamsResult.value : [];
  const rtcFleet = rtcFleetResult.status === 'fulfilled' ? rtcFleetResult.value : undefined;

  const base = `/dashboard/projects/${projectId}`;
  const hasActivity = connections.length > 0 || (rooms?.length ?? 0) > 0;

  const onboardingSteps = buildOnboardingSteps(projectId, {
    hasApiKey: apiKeys.length > 0,
    hasConnection: connections.length > 0 || (rooms?.length ?? 0) > 0,
    hasChatActivity: (chatOverview?.conversations ?? 0) > 0 || (chatOverview?.messagesStored ?? 0) > 0,
    hasLiveStream: liveStreams.length > 0,
  });
  const onboardingComplete = onboardingSteps.every((s) => s.done);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={project.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {project.status === 'ACTIVE' ? 'Active' : 'Archived'}
            </Badge>
            {/* The raw project ID, one click from the clipboard: it goes in
                every server SDK call, so it must never hide behind Settings. */}
            <span className="flex items-center gap-1 text-xs text-subtle">
              <span className="font-mono">{project.id}</span>
              <CopyButton value={project.id} label="Copy project ID" iconOnly />
            </span>
          </span>
        }
        actions={
          <>
            <RangeSelector basePath={`${base}/overview`} current={range} />
            <ButtonLink href={`${base}/api-keys`} variant="secondary">
              API keys
            </ButtonLink>
            <ButtonLink href={`${base}/members`} variant="ghost">
              Invite
            </ButtonLink>
            <ButtonLink href={`${base}/settings`} variant="ghost">
              Settings
            </ButtonLink>
          </>
        }
      />

      {!onboardingComplete && <OnboardingProgress steps={onboardingSteps} />}

      {!hasActivity ? (
        <Card>
          <p className="text-sm leading-relaxed text-muted">
            No rooms or connections yet — telemetry appears here automatically the moment your backend mints a token and
            a client joins with <code className="font-mono text-xs text-fg">@ravenkash/rtc</code>. Follow the steps
            above, or open the{' '}
            <a href={`${base}/quickstart`} className="text-accent-text hover:underline">
              quickstart
            </a>
            .
          </p>
        </Card>
      ) : (
        <>
          <section>
            <SectionHeader
              title="Live activity"
              subtitle="Connections currently open, straight from the connection records."
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Active rooms"
                value={metrics ? formatCount(metrics.activeRooms) : <NoDataYet label="Unknown" />}
              />
              <StatCard
                label="Active participants"
                value={metrics ? formatCount(metrics.activeParticipants) : <NoDataYet label="Unknown" />}
              />
              <StatCard
                label="Active connections"
                value={diagnostics ? formatCount(diagnostics.connections.active) : <NoDataYet label="Unknown" />}
              />
              <StatCard
                label="Rooms created"
                value={rooms ? formatCount(rooms.length) : <NoDataYet label="Unknown" />}
                hint="All time"
              />
            </div>
          </section>

          <section>
            <SectionHeader title="RTC connections" subtitle={RANGE_LABEL[range]} />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <RateTile
                label="Connection success"
                value={metrics?.connectionSuccessRate ?? null}
                tone={rateTone(metrics?.connectionSuccessRate ?? null, { good: 95, warn: 80 })}
              />
              <RateTile
                label="Reconnect rate"
                value={metrics?.reconnectionRate ?? null}
                tone={rateTone(metrics?.reconnectionRate ?? null, { good: 5, warn: 20 }, true)}
                invert
              />
              <StatCard
                label="Avg. connection duration"
                value={
                  metrics?.averageConnectionDurationMs != null ? (
                    formatDuration(metrics.averageConnectionDurationMs)
                  ) : (
                    <NoDataYet label="No completed connections" />
                  )
                }
                hint={metrics ? `${formatCount(metrics.connections)} connections in window` : undefined}
              />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <RecentConnections base={base} connections={connections} />
            <RecentErrors base={base} errors={errors} errorCount={metrics?.errors} range={range} />
          </div>
        </>
      )}

      <section>
        <SectionHeader title="Infrastructure" subtitle="Live dependency checks for this project." />
        <Card>
          {diagnostics ? (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <HealthItem label="Control API" status="up" />
                <HealthItem label="Authentication" status="up" />
                <HealthItem label="Signaling" status={diagnostics.dependencies.signaling} />
                <HealthItem label="SFU" status={diagnostics.dependencies.sfu} />
                <HealthItem label="TURN" status={diagnostics.dependencies.turn} />
              </dl>
              <RtcFleetLine base={base} fleet={rtcFleet} />
              <div className="mt-5 border-t border-line pt-4">
                <a
                  href={`${base}/diagnostics`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
                >
                  Full diagnostics
                  <IconChevronRight className="size-3" />
                </a>
              </div>
            </>
          ) : (
            <NoDataYet label="Diagnostics are unavailable right now" />
          )}
        </Card>
      </section>
    </div>
  );
}

/**
 * Whether the media plane can actually take a new room.
 *
 * Distinct from the `SFU` check above, which probes one registered node's
 * liveness. Both can be green while no room can be allocated: every node
 * draining, or every node at its advertised capacity. That gap is exactly
 * what `RAVEN_NO_RTC_CAPACITY` reports to a caller, and this is the line
 * that explains it without opening another page.
 */
function RtcFleetLine({ base, fleet }: { base: string; fleet?: RtcFleetMetrics }) {
  if (!fleet) {
    return (
      <p className="mt-4 border-t border-line pt-4 text-xs text-subtle">
        The RTC fleet inventory could not be read, so allocation capacity is unknown.
      </p>
    );
  }

  const noneAllocatable = fleet.healthyServers === 0;
  const full = !noneAllocatable && fleet.capacity > 0 && fleet.activeRooms >= fleet.capacity;

  return (
    <p
      className={`mt-4 border-t border-line pt-4 text-xs ${
        noneAllocatable || full ? 'text-danger-text' : 'text-muted'
      }`}
    >
      {fleet.servers === 0 ? (
        <>No SFU has registered with this deployment, so every join will fail.</>
      ) : noneAllocatable ? (
        <>
          {formatCount(fleet.servers)} RTC server(s) registered but <strong>none allocatable</strong> —{' '}
          {formatCount(fleet.drainingServers)} draining, {formatCount(fleet.unhealthyServers)} not answering. New rooms
          cannot be placed.
        </>
      ) : (
        <>
          {formatCount(fleet.healthyServers)} of {formatCount(fleet.servers)} RTC server(s) allocatable, serving{' '}
          {formatCount(fleet.activeRooms)} room(s) and {formatCount(fleet.activeParticipants)} participant(s).
          {full && ' Advertised capacity is exhausted.'}
        </>
      )}{' '}
      <a href={`${base}/servers`} className="font-medium text-accent-text hover:underline">
        Fleet
      </a>
    </p>
  );
}

function HealthItem({ label, status }: { label: string; status: 'up' | 'down' }) {
  return (
    <div>
      <dt className="mb-1.5 text-xs font-medium text-muted">{label}</dt>
      <dd>
        <StatusBadge status={status} />
      </dd>
    </div>
  );
}

/**
 * Percentage tile with a bar. `invert` flips the semantics for rates
 * where lower is better (reconnects) so the bar still fills to the right
 * but the colour reads correctly.
 */
function RateTile({
  label,
  value,
  tone,
  invert = false,
}: {
  label: string;
  value: number | null;
  tone: 'success' | 'warning' | 'danger' | 'accent';
  invert?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      {value === null ? (
        <div className="mt-1.5">
          <NoDataYet label="No connections in this window" />
        </div>
      ) : (
        <>
          <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-fg">{value}%</div>
          <div className="mt-3">
            <RateBar value={invert ? 100 - value : value} tone={tone} />
          </div>
        </>
      )}
    </div>
  );
}

function rateTone(
  value: number | null,
  thresholds: { good: number; warn: number },
  lowerIsBetter = false,
): 'success' | 'warning' | 'danger' | 'accent' {
  if (value === null) return 'accent';
  if (lowerIsBetter) {
    if (value <= thresholds.good) return 'success';
    if (value <= thresholds.warn) return 'warning';
    return 'danger';
  }
  if (value >= thresholds.good) return 'success';
  if (value >= thresholds.warn) return 'warning';
  return 'danger';
}

function RecentConnections({
  base,
  connections,
}: {
  base: string;
  connections: Awaited<ReturnType<typeof ravenApi.listConnections>>;
}) {
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader
          title="Recent connections"
          action={
            <a href={`${base}/connections`} className="text-xs font-medium text-accent-text hover:underline">
              View all
            </a>
          }
        />
      </div>
      {connections.length === 0 ? (
        <div className="px-5 pb-5">
          <NoDataYet label="No connections recorded yet" />
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {connections.map((c) => (
            <li key={c.publicId}>
              <a
                href={`${base}/connections/${c.publicId}`}
                className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-raised"
              >
                <ConnectionStateBadge state={c.state} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{c.participantIdentity}</span>
                  <span className="block truncate text-xs text-muted">{c.roomName}</span>
                </span>
                <span className="tabular shrink-0 text-xs text-subtle">{formatRelative(c.startedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentErrors({
  base,
  errors,
  errorCount,
  range,
}: {
  base: string;
  errors: Awaited<ReturnType<typeof ravenApi.listErrors>>;
  errorCount: number | undefined;
  range: string;
}) {
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader
          title="Recent errors"
          subtitle={
            errorCount !== undefined
              ? `${formatCount(errorCount)} in the ${RANGE_LABEL[range as keyof typeof RANGE_LABEL]?.toLowerCase() ?? range}`
              : undefined
          }
          action={
            <a href={`${base}/errors`} className="text-xs font-medium text-accent-text hover:underline">
              View all
            </a>
          }
        />
      </div>
      {errors.length === 0 ? (
        <div className="px-5 pb-5">
          <p className="text-sm text-muted">
            No errors recorded. Either everything is healthy, or nothing has connected yet.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {errors.map((e) => (
            <li key={e.publicId}>
              <a
                href={`${base}/errors/${e.publicId}`}
                className="flex items-start gap-3 px-5 py-2.5 transition-colors hover:bg-surface-raised"
              >
                <span className="mt-0.5 shrink-0">
                  <ErrorCategoryBadge category={e.category} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{e.message}</span>
                  <span className="block truncate text-xs text-muted">
                    {e.connectionId ? <MonoId value={e.connectionId} /> : <Dash />}
                  </span>
                </span>
                <span className="tabular shrink-0 text-xs text-subtle">{formatRelative(e.timestamp)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
