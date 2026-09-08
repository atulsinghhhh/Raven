import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import {
  ApiError,
  ravenApi,
  type ChatOverview,
  type LiveStreamSummary,
  type ObservabilityOverview,
  type Project,
} from '@/lib/api-client';
import { AccountShell } from '@/components/shell/account-shell';
import { deriveSystemStatus } from '@/components/ui/badge';
import { BarChart } from '@/components/ui/chart';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { RangeSelector } from '@/components/ui/range-selector';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { IconAnalytics } from '@/components/ui/icons';
import { formatCount, formatPercent, normaliseRange, RANGE_LABEL, type Range } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Analytics — Raven',
};

/**
 * Cross-project analytics. Every figure is a sum of per-project telemetry
 * for the selected window — there is no separate metering pipeline, so
 * what the projects report is what this page shows. Fan-out is capped and
 * stated, same as the overview.
 */
const PROJECT_LIMIT = 12;

interface Snapshot {
  project: Project;
  metrics?: ObservabilityOverview;
  chat?: ChatOverview;
  streams?: LiveStreamSummary[];
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const token = await getSessionToken();
  if (!token) redirect('/login');
  const email = decodeSessionEmail(token);
  const range: Range = normaliseRange((await searchParams).range);

  const [projectsResult, healthResult] = await Promise.allSettled([ravenApi.listProjects(token), ravenApi.getHealth()]);
  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';

  if (projectsResult.status === 'rejected') {
    if (projectsResult.reason instanceof ApiError && projectsResult.reason.status === 401) redirect('/login');
    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        <ErrorState
          title="Could not load analytics"
          description="The Control API is unreachable right now. Retry in a moment."
          retryHref="/dashboard/analytics"
        />
      </AccountShell>
    );
  }

  const projects = [...projectsResult.value]
    .filter((p) => p.status === 'ACTIVE')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, PROJECT_LIMIT);

  if (projects.length === 0) {
    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        <div className="flex flex-col gap-8">
          <PageHeader title="Analytics" description="Cross-project usage and health." />
          <EmptyState
            icon={<IconAnalytics className="size-7" />}
            title="Nothing to measure yet"
            description="Create a project and send some traffic — connections, messages, and streams will show up here."
          />
        </div>
      </AccountShell>
    );
  }

  const snapshots: Snapshot[] = await Promise.all(
    projects.map(async (project) => {
      const [metricsR, chatR, streamsR] = await Promise.allSettled([
        ravenApi.getMetrics(token, project.id, range),
        ravenApi.getChatOverview(token, project.id, range),
        ravenApi.listLiveStreams(token, project.id),
      ]);
      return {
        project,
        metrics: metricsR.status === 'fulfilled' ? metricsR.value : undefined,
        chat: chatR.status === 'fulfilled' ? chatR.value : undefined,
        streams: streamsR.status === 'fulfilled' ? streamsR.value : undefined,
      };
    }),
  );

  const withMetrics = snapshots.filter((s) => s.metrics);
  const withChat = snapshots.filter((s) => s.chat);

  const sum = (values: Array<number | undefined>) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

  const totals = {
    participants: withMetrics.length ? sum(withMetrics.map((s) => s.metrics!.activeParticipants)) : null,
    connections: withMetrics.length ? sum(withMetrics.map((s) => s.metrics!.connections)) : null,
    messages: withChat.length ? sum(withChat.map((s) => s.chat!.messagesSent)) : null,
    errors: withMetrics.length ? sum(withMetrics.map((s) => s.metrics!.errors)) : null,
    liveStreams: sum(snapshots.map((s) => s.streams?.filter((x) => x.status === 'LIVE').length)),
    peakViewers: sum(snapshots.map((s) => sum((s.streams ?? []).map((x) => x.peakViewerCount)))),
  };

  const successRates = withMetrics
    .map((s) => s.metrics!.connectionSuccessRate)
    .filter((v): v is number => v !== null);
  const successRate = successRates.length ? successRates.reduce((a, b) => a + b, 0) / successRates.length : null;

  const bars = (value: (s: Snapshot) => number | undefined, unit: string) =>
    snapshots
      .filter((s) => value(s) !== undefined)
      .map((s) => ({
        label: s.project.name.slice(0, 10),
        value: value(s)!,
        hint: `${s.project.name}: ${formatCount(value(s)!)} ${unit}`,
      }));

  return (
    <AccountShell email={email} systemStatus={systemStatus}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Analytics"
          description={`Summed across your ${projects.length} most recently active projects — ${RANGE_LABEL[range].toLowerCase()}.`}
          actions={<RangeSelector basePath="/dashboard/analytics" current={range} />}
        />

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Active participants"
            value={totals.participants !== null ? formatCount(totals.participants) : <NoDataYet label="Unknown" />}
          />
          <StatCard
            label="RTC connections"
            value={totals.connections !== null ? formatCount(totals.connections) : <NoDataYet label="Unknown" />}
            hint={RANGE_LABEL[range]}
          />
          <StatCard
            label="Chat messages"
            value={totals.messages !== null ? formatCount(totals.messages) : <NoDataYet label="Unknown" />}
            hint={RANGE_LABEL[range]}
          />
          <StatCard label="Live streams now" value={formatCount(totals.liveStreams)} />
          <StatCard label="Peak stream viewers" value={formatCount(totals.peakViewers)} hint="All-time, per stream" />
          <StatCard
            label="Errors"
            value={totals.errors !== null ? formatCount(totals.errors) : <NoDataYet label="Unknown" />}
            hint={successRate !== null ? `${formatPercent(successRate)} connect success` : RANGE_LABEL[range]}
            tone={totals.errors ? 'warning' : 'default'}
          />
        </section>

        <section>
          <SectionHeader title="By project" subtitle="Where the traffic is coming from." />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <p className="mono-label text-xs text-muted">RTC connections</p>
              <div className="mt-3">
                <BarChart
                  data={bars((s) => s.metrics?.connections, 'connections')}
                  height={112}
                  emptyLabel="No data in this window"
                  caption={`Connections per project, ${RANGE_LABEL[range].toLowerCase()}.`}
                />
              </div>
            </Card>
            <Card>
              <p className="mono-label text-xs text-muted">Chat messages</p>
              <div className="mt-3">
                <BarChart
                  data={bars((s) => s.chat?.messagesSent, 'messages')}
                  height={112}
                  emptyLabel="No data in this window"
                  caption={`Messages sent per project, ${RANGE_LABEL[range].toLowerCase()}.`}
                />
              </div>
            </Card>
            <Card>
              <p className="mono-label text-xs text-muted">Errors</p>
              <div className="mt-3">
                <BarChart
                  data={bars((s) => s.metrics?.errors, 'errors')}
                  height={112}
                  emptyLabel="No errors in this window"
                  caption={`RTC errors per project, ${RANGE_LABEL[range].toLowerCase()}.`}
                  tone="danger"
                />
              </div>
            </Card>
          </div>
        </section>
      </div>
    </AccountShell>
  );
}
