import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import {
  ApiError,
  ravenApi,
  type ConnectionLifecycleState,
  type ConnectionSummary,
  type ErrorCategory,
  type ErrorSummary,
} from '@/lib/api-client';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { BarChart, DistributionBar, RateBar, type Bucket } from '@/components/ui/chart';
import { PageHeader } from '@/components/ui/page-header';
import { RangeSelector } from '@/components/ui/range-selector';
import { ErrorState, NoDataYet } from '@/components/ui/states';
import {
  formatClockTime,
  formatCount,
  formatDate,
  formatDuration,
  normaliseRange,
  RANGE_LABEL,
  RANGE_MS,
  type Range,
} from '@/lib/format';

/**
 * Metrics.
 *
 * The API's metrics endpoint returns one aggregate snapshot per window,
 * not a time series: there is no historical store behind it. So the
 * headline numbers come straight from that snapshot, and the two charts
 * are bucketed here from the raw connection and error records. That is
 * real data, but it is capped at the 200 most recent records per list,
 * which is stated on every chart, not buried in a tooltip.
 *
 * Nothing on this page is estimated, interpolated or simulated.
 */

const FETCH_LIMIT = 200;
const BUCKET_COUNT = 24;

const CONNECTION_STATES: readonly ConnectionLifecycleState[] = [
  'CONNECTED',
  'CONNECTING',
  'RECONNECTING',
  'DISCONNECTED',
  'FAILED',
];

const STATE_LABEL: Record<ConnectionLifecycleState, string> = {
  CONNECTED: 'Connected',
  CONNECTING: 'Connecting',
  RECONNECTING: 'Reconnecting',
  DISCONNECTED: 'Disconnected',
  FAILED: 'Failed',
};

const STATE_SWATCH: Record<ConnectionLifecycleState, string> = {
  CONNECTED: 'bg-success',
  CONNECTING: 'bg-warning/60',
  RECONNECTING: 'bg-warning',
  DISCONNECTED: 'bg-line-strong',
  FAILED: 'bg-danger',
};

const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  'AUTHENTICATION_ERROR',
  'AUTHORIZATION_ERROR',
  'TOKEN_ERROR',
  'SIGNALING_ERROR',
  'ICE_ERROR',
  'TURN_ERROR',
  'SFU_ERROR',
  'NETWORK_ERROR',
  'CLIENT_ERROR',
  'UNKNOWN_ERROR',
];

const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  AUTHENTICATION_ERROR: 'Authentication',
  AUTHORIZATION_ERROR: 'Authorization',
  TOKEN_ERROR: 'Token',
  SIGNALING_ERROR: 'Signaling',
  ICE_ERROR: 'ICE',
  TURN_ERROR: 'TURN',
  SFU_ERROR: 'SFU',
  NETWORK_ERROR: 'Network',
  CLIENT_ERROR: 'Client',
  UNKNOWN_ERROR: 'Unknown',
};

/** Same tone families the error badges use; the legend always names each segment. */
const CATEGORY_SWATCH: Record<ErrorCategory, string> = {
  AUTHENTICATION_ERROR: 'bg-danger',
  AUTHORIZATION_ERROR: 'bg-danger/65',
  TOKEN_ERROR: 'bg-danger/40',
  SIGNALING_ERROR: 'bg-warning',
  ICE_ERROR: 'bg-warning/75',
  TURN_ERROR: 'bg-warning/55',
  SFU_ERROR: 'bg-warning/35',
  NETWORK_ERROR: 'bg-info',
  CLIENT_ERROR: 'bg-info/60',
  UNKNOWN_ERROR: 'bg-line-strong',
};

export default async function MetricsPage({
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

  // Each panel degrades on its own: a failing list shouldn't blank the
  // snapshot a developer opened the page for.
  const [metricsResult, connectionsResult, errorsResult] = await Promise.allSettled([
    ravenApi.getMetrics(token, projectId, range),
    ravenApi.listConnections(token, projectId, { limit: FETCH_LIMIT }),
    ravenApi.listErrors(token, projectId, { limit: FETCH_LIMIT }),
  ]);

  for (const result of [metricsResult, connectionsResult, errorsResult]) {
    if (result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status === 401) {
      redirect('/login');
    }
  }

  const base = `/dashboard/projects/${projectId}`;

  if (
    metricsResult.status === 'rejected' &&
    connectionsResult.status === 'rejected' &&
    errorsResult.status === 'rejected'
  ) {
    return (
      <ErrorState
        title="Could not load metrics"
        description="The Control API is unreachable right now. Your telemetry is unaffected — retry in a moment."
        retryHref={`${base}/metrics?range=${range}`}
      />
    );
  }

  const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : undefined;
  const connections: ConnectionSummary[] = connectionsResult.status === 'fulfilled' ? connectionsResult.value : [];
  const errors: ErrorSummary[] = errorsResult.status === 'fulfilled' ? errorsResult.value : [];

  const now = renderClock();
  const connectionSeries = bucketise(
    connections.map((c) => c.startedAt),
    range,
    now,
  );
  const errorSeries = bucketise(
    errors.map((e) => e.timestamp),
    range,
    now,
  );

  const windowConnections = connections.filter((c) => withinWindow(c.startedAt, range, now));
  const windowErrors = errors.filter((e) => withinWindow(e.timestamp, range, now));

  const stateCounts = tally(windowConnections.map((c) => c.state));
  const categoryCounts = tally(windowErrors.map((e) => e.category));

  // If the window genuinely holds more connections than the record cap,
  // the earliest buckets under-count. Say so instead of letting the chart
  // imply a quiet period that never happened.
  const connectionsTruncated =
    metrics !== undefined && connections.length >= FETCH_LIMIT && metrics.connections > connectionSeries.covered;
  const errorsTruncated = metrics !== undefined && errors.length >= FETCH_LIMIT && metrics.errors > errorSeries.covered;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Metrics"
        description="What Livqeno measured for this project. Every number here is a value the Control API returned — where a figure is derived from raw records rather than read directly, it says so."
        actions={<RangeSelector basePath={`${base}/metrics`} current={range} />}
      />

      {metricsResult.status === 'rejected' && (
        <ErrorState
          title="The metrics snapshot failed to load"
          description="Charts below are still derived from the raw connection and error records, but the headline aggregates are unavailable."
          retryHref={`${base}/metrics?range=${range}`}
        />
      )}

      <section>
        <SectionHeader title="This window" subtitle={`${RANGE_LABEL[range]}, from the metrics endpoint.`} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Connections"
            value={metrics ? formatCount(metrics.connections) : <NoDataYet label="Unavailable" />}
            hint="Started in this window"
          />
          <StatCard
            label="Active rooms"
            value={metrics ? formatCount(metrics.activeRooms) : <NoDataYet label="Unavailable" />}
            hint="Right now"
          />
          <StatCard
            label="Active participants"
            value={metrics ? formatCount(metrics.activeParticipants) : <NoDataYet label="Unavailable" />}
            hint="Right now"
          />
          <StatCard
            label="Errors"
            value={metrics ? formatCount(metrics.errors) : <NoDataYet label="Unavailable" />}
            hint="Reported in this window"
            tone={metrics && metrics.errors > 0 ? 'danger' : 'default'}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Connection quality"
          subtitle="Rates are null when nothing connected in the window — that is shown as no data, never as zero."
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <RateTile
            label="Connection success rate"
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
            label="Average connection duration"
            value={
              metrics?.averageConnectionDurationMs != null ? (
                formatDuration(metrics.averageConnectionDurationMs)
              ) : (
                <NoDataYet label="No completed connections" />
              )
            }
            hint={metrics ? `Across ${formatCount(metrics.connections)} connections in this window` : undefined}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Activity over time"
          subtitle="Livqeno has no time-series store. These two charts are bucketed in the console from the raw records the list endpoints return."
        />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <h3 className="text-sm font-semibold text-fg">Connections started</h3>
            <p className="mt-1 mb-4 text-xs leading-relaxed text-muted">
              Derived from the {FETCH_LIMIT} most recent connection records, bucketed by their real{' '}
              <code className="font-mono text-[0.6875rem] text-fg">startedAt</code> across{' '}
              {RANGE_LABEL[range].toLowerCase()}.
              {connectionsResult.status === 'rejected' && ' The connection list failed to load.'}
            </p>
            <BarChart
              data={connectionSeries.data}
              caption={`Connections started per bucket across ${RANGE_LABEL[range].toLowerCase()}, derived from the ${FETCH_LIMIT} most recent connection records.`}
              emptyLabel={
                connectionsResult.status === 'rejected'
                  ? 'Connection records unavailable'
                  : 'No connections started in this window'
              }
            />
            <p className="mt-3 text-xs text-subtle">
              {formatCount(connectionSeries.covered)} of the fetched records fall inside this window.
              {connectionsTruncated &&
                ` The metrics endpoint counted ${formatCount(metrics?.connections ?? 0)} connections here, so the earliest buckets under-count — the record list is capped at ${FETCH_LIMIT}.`}
            </p>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-fg">Errors reported</h3>
            <p className="mt-1 mb-4 text-xs leading-relaxed text-muted">
              Derived from the {FETCH_LIMIT} most recent error records, bucketed by their real{' '}
              <code className="font-mono text-[0.6875rem] text-fg">timestamp</code> across{' '}
              {RANGE_LABEL[range].toLowerCase()}.
              {errorsResult.status === 'rejected' && ' The error list failed to load.'}
            </p>
            <BarChart
              data={errorSeries.data}
              tone="danger"
              caption={`Errors reported per bucket across ${RANGE_LABEL[range].toLowerCase()}, derived from the ${FETCH_LIMIT} most recent error records.`}
              emptyLabel={
                errorsResult.status === 'rejected' ? 'Error records unavailable' : 'No errors reported in this window'
              }
            />
            <p className="mt-3 text-xs text-subtle">
              {formatCount(errorSeries.covered)} of the fetched records fall inside this window.
              {errorsTruncated &&
                ` The metrics endpoint counted ${formatCount(metrics?.errors ?? 0)} errors here, so the earliest buckets under-count — the record list is capped at ${FETCH_LIMIT}.`}
            </p>
          </Card>
        </div>
      </section>

      <section>
        <SectionHeader title="Distributions" subtitle="How the fetched records in this window break down." />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <h3 className="text-sm font-semibold text-fg">Connection states</h3>
            <p className="mt-1 mb-4 text-xs leading-relaxed text-muted">
              Last reported state of the {formatCount(windowConnections.length)} fetched connections that started in
              this window.
            </p>
            <DistributionBar
              segments={CONNECTION_STATES.map((s) => ({
                label: STATE_LABEL[s],
                value: stateCounts[s] ?? 0,
                className: STATE_SWATCH[s],
              }))}
              caption={`Connection states across ${formatCount(windowConnections.length)} fetched connection records in ${RANGE_LABEL[range].toLowerCase()}.`}
            />
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-fg">Error categories</h3>
            <p className="mt-1 mb-4 text-xs leading-relaxed text-muted">
              Category split of the {formatCount(windowErrors.length)} fetched errors reported in this window.
            </p>
            <DistributionBar
              segments={ERROR_CATEGORIES.map((c) => ({
                label: CATEGORY_LABEL[c],
                value: categoryCounts[c] ?? 0,
                className: CATEGORY_SWATCH[c],
              }))}
              caption={`Error categories across ${formatCount(windowErrors.length)} fetched error records in ${RANGE_LABEL[range].toLowerCase()}.`}
            />
          </Card>
        </div>
      </section>

      <section>
        <SectionHeader
          title="What Livqeno does not measure yet"
          subtitle="So you know what this page can't tell you."
        />
        <Card>
          <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-muted">
            <NotMeasured title="Latency and jitter">
              Round-trip time between peers and the SFU is not collected. Nothing here reflects call quality.
            </NotMeasured>
            <NotMeasured title="Bandwidth and TURN relay usage">
              Bytes sent, received or relayed through TURN are not recorded, so relay cost cannot be attributed.
            </NotMeasured>
            <NotMeasured title="Packet loss and media scores">
              No per-track statistics are ingested — a connection can be reported as healthy while its audio is poor.
            </NotMeasured>
            <NotMeasured title="Historical aggregation">
              There is no time-series store. The snapshot above is recomputed per request, and the charts are bucketed
              from the {FETCH_LIMIT} most recent raw records — which is why longer ranges get coarser, not deeper.
            </NotMeasured>
          </ul>
        </Card>
      </section>
    </div>
  );
}

function NotMeasured({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
      <span>
        <span className="font-medium text-fg">{title}.</span> {children}
      </span>
    </li>
  );
}

/**
 * One clock read per request. This is an async Server Component: it
 * renders exactly once per navigation, so both charts and both
 * distributions share a single window boundary rather than each
 * computing a slightly different "now".
 */
function renderClock(): number {
  return Date.now();
}

function tally<T extends string>(values: T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function withinWindow(iso: string, range: Range, now: number): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t <= now && now - t <= RANGE_MS[range];
}

/**
 * Buckets real timestamps into equal slices across the selected window.
 * Anything outside the window is dropped instead of clamped into the
 * edge buckets, which would invent activity that didn't happen there.
 */
function bucketise(timestamps: string[], range: Range, now: number): { data: Bucket[]; covered: number } {
  const span = RANGE_MS[range];
  const start = now - span;
  const width = span / BUCKET_COUNT;
  const counts = new Array<number>(BUCKET_COUNT).fill(0);
  let covered = 0;

  for (const iso of timestamps) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t < start || t > now) continue;
    const index = Math.min(BUCKET_COUNT - 1, Math.floor((t - start) / width));
    counts[index] += 1;
    covered += 1;
  }

  const data = counts.map((value, i) => {
    const from = bucketLabel(start + i * width, range);
    const to = bucketLabel(start + (i + 1) * width, range);
    return { label: from, value, hint: `${from} – ${to}: ${value}` };
  });

  return { data, covered };
}

function bucketLabel(ms: number, range: Range): string {
  const iso = new Date(ms).toISOString();
  return range === '7d' ? formatDate(iso) : formatClockTime(iso);
}

/**
 * Percentage tile with a bar. `invert` flips the fill for rates where
 * lower is better (reconnects), so the bar still fills to the right while
 * the colour keeps reading correctly.
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
