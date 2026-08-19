import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge, ConnectionStateBadge, ErrorCategoryBadge, StatusBadge } from '@/components/ui/badge';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { RangeSelector } from '@/components/ui/range-selector';
import { RateBar } from '@/components/ui/chart';
import { ButtonLink } from '@/components/ui/button';
import { MonoId } from '@/components/ui/mono';
import { Dash, ErrorState, NoDataYet } from '@/components/ui/states';
import { IconChevronRight, IconQuickstart } from '@/components/ui/icons';
import { formatCount, formatDuration, formatRelative, normaliseRange, RANGE_LABEL } from '@/lib/format';

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
  const [projectResult, metricsResult, diagnosticsResult, connectionsResult, errorsResult, roomsResult] =
    await Promise.allSettled([
      ravenApi.getProject(token, projectId),
      ravenApi.getMetrics(token, projectId, range),
      ravenApi.getDiagnostics(token, projectId),
      ravenApi.listConnections(token, projectId, { limit: 8 }),
      ravenApi.listErrors(token, projectId, { limit: 5 }),
      ravenApi.listRooms(token, projectId),
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

  const base = `/dashboard/projects/${projectId}`;
  const hasActivity = connections.length > 0 || (rooms?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        meta={<Badge tone={project.status === 'ACTIVE' ? 'success' : 'neutral'}>{project.status === 'ACTIVE' ? 'Active' : 'Archived'}</Badge>}
        actions={<RangeSelector basePath={`${base}/overview`} current={range} />}
      />

      {!hasActivity ? (
        <GetStartedPanel projectId={projectId} />
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
          <p className="text-sm text-muted">No errors recorded. Either everything is healthy, or nothing has connected yet.</p>
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

/** Shown until the project has any rooms or connections at all. */
function GetStartedPanel({ projectId }: { projectId: string }) {
  const base = `/dashboard/projects/${projectId}`;

  return (
    <Card>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent">
          <IconQuickstart className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">Build your first Raven application</h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">
            This project has no rooms or connections yet. Create an API key, mint a token from your backend, and join a
            room from the browser — connection and error telemetry starts appearing here automatically.
          </p>
          <ol className="mt-4 flex flex-col gap-2 text-sm text-muted">
            <Step n={1}>
              Create an API key in <a href={`${base}/api-keys`} className="text-accent-text hover:underline">API Keys</a>
            </Step>
            <Step n={2}>
              Mint an RTC token from your backend with <code className="font-mono text-xs text-fg">@corvidhq/server</code>
            </Step>
            <Step n={3}>
              Join a room in the browser with <code className="font-mono text-xs text-fg">@corvidhq/rtc</code>
            </Step>
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <ButtonLink href={`${base}/quickstart`} variant="primary">
              Open quickstart
            </ButtonLink>
            <ButtonLink href={`${base}/api-keys`} variant="secondary">
              Create an API key
            </ButtonLink>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[0.6875rem] font-medium text-muted">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}
