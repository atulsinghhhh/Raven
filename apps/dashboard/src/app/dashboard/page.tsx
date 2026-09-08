import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import {
  ApiError,
  ravenApi,
  type AuditLogEntry,
  type ChatOverview,
  type LiveStreamSummary,
  type ObservabilityOverview,
  type Project,
  type ProjectDiagnostics,
} from '@/lib/api-client';
import { AccountShell } from '@/components/shell/account-shell';
import { Badge, deriveSystemStatus } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { BarChart } from '@/components/ui/chart';
import { Card, CardHeader, SectionHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { RangeSelector } from '@/components/ui/range-selector';
import { ErrorState, NoDataYet } from '@/components/ui/states';
import {
  IconAudit,
  IconChat,
  IconChevronRight,
  IconExternal,
  IconLiveStreaming,
  IconPlus,
  IconRooms,
} from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';
import { formatCount, formatRelative, normaliseRange, RANGE_LABEL, type Range } from '@/lib/format';

/**
 * Account overview: the first screen after sign-in. A greeting, the
 * projects with their per-product activity, a cross-project usage strip,
 * and the recent audit feed.
 *
 * There is no cross-project aggregate endpoint and no usage/billing
 * backend, so every number here is derived by fetching each project's own
 * per-project data and summing it. Live detail is capped at DETAIL_LIMIT
 * active projects (most recently updated first) so this page doesn't fan
 * out to dozens of API calls; the cap is always stated on screen rather
 * than silently truncating.
 */

const DETAIL_LIMIT = 8;
const ACTIVITY_LIMIT = 8;

/** Overview trades in days, not minutes — the day-scale subset of RANGES. */
const OVERVIEW_RANGES: readonly Range[] = ['7d', '30d', '90d'];

interface ProjectSnapshot {
  project: Project;
  metrics?: ObservabilityOverview;
  chat?: ChatOverview;
  streams?: LiveStreamSummary[];
  diagnostics?: ProjectDiagnostics;
  audit: AuditLogEntry[];
}

async function loadSnapshot(token: string, project: Project, range: Range): Promise<ProjectSnapshot> {
  const [metricsR, chatR, streamsR, diagnosticsR, auditR] = await Promise.allSettled([
    ravenApi.getMetrics(token, project.id, range),
    ravenApi.getChatOverview(token, project.id, range),
    ravenApi.listLiveStreams(token, project.id),
    ravenApi.getDiagnostics(token, project.id),
    ravenApi.listAuditLogs(token, project.id, { limit: 5 }),
  ]);

  return {
    project,
    metrics: metricsR.status === 'fulfilled' ? metricsR.value : undefined,
    chat: chatR.status === 'fulfilled' ? chatR.value : undefined,
    streams: streamsR.status === 'fulfilled' ? streamsR.value : undefined,
    diagnostics: diagnosticsR.status === 'fulfilled' ? diagnosticsR.value : undefined,
    // A developer-role member gets a 403 here (audit:read is owner/admin
    // only): that's indistinguishable from "no activity", so it just
    // renders as no activity instead of an error for this one project.
    audit: auditR.status === 'fulfilled' ? auditR.value : [],
  };
}

/** action strings are "resource.verb" (see AuditAction in apps/api): this only reformats, it never invents a label. */
function humanizeAction(action: string): string {
  const text = action.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function DashboardHomePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const rawRange = normaliseRange((await searchParams).range);
  const range: Range = OVERVIEW_RANGES.includes(rawRange) ? rawRange : '7d';
  const email = decodeSessionEmail(token);

  const [projectsResult, healthResult, profileResult] = await Promise.allSettled([
    ravenApi.listProjects(token),
    ravenApi.getHealth(),
    ravenApi.getMe(token),
  ]);

  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : undefined;
  const firstName = profile?.name?.trim().split(/\s+/)[0] ?? email?.split('@')[0];

  if (projectsResult.status === 'rejected') {
    if (projectsResult.reason instanceof ApiError && projectsResult.reason.status === 401) redirect('/login');
    return (
      <AccountShell email={email} name={profile?.name} systemStatus={systemStatus}>
        <ErrorState
          title="Could not load your account"
          description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
          retryHref="/dashboard"
        />
      </AccountShell>
    );
  }

  const projects = projectsResult.value;

  const header = (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="display text-2xl text-fg sm:text-[1.75rem]">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-1.5 text-sm text-muted">Here’s what’s happening across your Raven projects.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ButtonLink href={DOCS_URL} variant="ghost">
          <IconExternal className="size-3.5" />
          Read documentation
        </ButtonLink>
        <ButtonLink href="/dashboard/projects?new=1" variant="primary">
          <IconPlus className="size-3.5" />
          Create project
        </ButtonLink>
      </div>
    </header>
  );

  if (projects.length === 0) {
    return (
      <AccountShell email={email} name={profile?.name} systemStatus={systemStatus}>
        <div className="flex flex-col gap-8">
          {header}
          <ZeroProjects />
        </div>
      </AccountShell>
    );
  }

  const activeProjects = [...projects]
    .filter((p) => p.status === 'ACTIVE')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const detailProjects = activeProjects.slice(0, DETAIL_LIMIT);
  const truncatedCount = projects.length - detailProjects.length;

  const snapshots = await Promise.all(detailProjects.map((p) => loadSnapshot(token, p, range)));

  const activityFeed = snapshots
    .flatMap((s) => s.audit.map((entry) => ({ entry, projectName: s.project.name, projectId: s.project.id })))
    .sort((a, b) => new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime())
    .slice(0, ACTIVITY_LIMIT);

  const withMetrics = snapshots.filter((s) => s.metrics);
  const usageCharts: Array<{
    title: string;
    caption: string;
    data: Array<{ label: string; value: number; hint?: string }>;
  }> = [
    {
      title: 'RTC connections',
      caption: `Connections per project, ${RANGE_LABEL[range].toLowerCase()}.`,
      data: withMetrics.map((s) => ({
        label: s.project.name.slice(0, 10),
        value: s.metrics!.connections,
        hint: `${s.project.name}: ${formatCount(s.metrics!.connections)} connections`,
      })),
    },
    {
      title: 'Chat messages',
      caption: `Messages sent per project, ${RANGE_LABEL[range].toLowerCase()}.`,
      data: snapshots
        .filter((s) => s.chat)
        .map((s) => ({
          label: s.project.name.slice(0, 10),
          value: s.chat!.messagesSent,
          hint: `${s.project.name}: ${formatCount(s.chat!.messagesSent)} messages`,
        })),
    },
    {
      title: 'Errors',
      caption: `RTC errors per project, ${RANGE_LABEL[range].toLowerCase()}.`,
      data: withMetrics.map((s) => ({
        label: s.project.name.slice(0, 10),
        value: s.metrics!.errors,
        hint: `${s.project.name}: ${formatCount(s.metrics!.errors)} errors`,
      })),
    },
  ];

  return (
    <AccountShell email={email} name={profile?.name} systemStatus={systemStatus}>
      <div className="flex flex-col gap-10">
        {header}

        <section>
          <SectionHeader
            title="Projects"
            subtitle={
              truncatedCount > 0
                ? `Live data for the ${detailProjects.length} most recently active of ${projects.length}.`
                : undefined
            }
            action={
              <Link href="/dashboard/projects" className="text-xs font-medium text-accent-text hover:underline">
                View all
              </Link>
            }
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {snapshots.map((s) => (
              <ProjectCard key={s.project.id} snapshot={s} range={range} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeader
            title="Usage"
            subtitle="Derived from each project's own telemetry — Raven has no separate billing meter."
            action={<RangeSelector basePath="/dashboard" current={range} ranges={OVERVIEW_RANGES} />}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {usageCharts.map((chart) => (
              <Card key={chart.title}>
                <p className="mono-label text-xs text-muted">{chart.title}</p>
                <div className="mt-3">
                  <BarChart data={chart.data} height={96} emptyLabel="No data in this window" caption={chart.caption} />
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader
                title="Recent activity"
                subtitle="Across your most recently active projects."
                action={
                  <Link href="/dashboard/activity" className="text-xs font-medium text-accent-text hover:underline">
                    View all activity
                  </Link>
                }
              />
            </div>
            {activityFeed.length === 0 ? (
              <div className="px-5 pb-5">
                <NoDataYet label="No recent activity" />
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {activityFeed.map(({ entry, projectName, projectId }) => (
                  <li key={entry.id}>
                    <Link
                      href={`/dashboard/projects/${projectId}/audit`}
                      className="flex items-start gap-3 px-5 py-2.5 transition-colors hover:bg-surface-raised"
                    >
                      <span className="mt-0.5 shrink-0 text-subtle">
                        <IconAudit className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{humanizeAction(entry.action)}</span>
                        <span className="block truncate text-xs text-muted">
                          {projectName} · {entry.actorEmail}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-xs text-subtle">{formatRelative(entry.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </AccountShell>
  );
}

/**
 * One project, three products. Every number is real per-project telemetry
 * for the selected window; a product whose fetch failed shows a dash, not
 * a zero.
 */
function ProjectCard({ snapshot, range }: { snapshot: ProjectSnapshot; range: Range }) {
  const { project, metrics, chat, streams, diagnostics } = snapshot;
  const operational = diagnostics ? deriveSystemStatus(diagnostics.dependencies) === 'operational' : undefined;
  const liveStreams = streams?.filter((s) => s.status === 'LIVE').length;

  return (
    <Card className="flex flex-col gap-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/projects/${project.id}/overview`}
            className="block truncate text-sm font-medium text-fg hover:text-accent-text"
          >
            {project.name}
          </Link>
          <span className="mt-1 flex items-center gap-1 text-xs text-subtle">
            <span className="truncate font-mono">{project.id.slice(0, 8)}…</span>
            <CopyButton value={project.id} label="Copy project ID" iconOnly />
          </span>
        </div>
        {operational === undefined ? (
          <Badge tone="neutral">Unknown</Badge>
        ) : operational ? (
          <Badge tone="success">Operational</Badge>
        ) : (
          <Badge tone="danger">Degraded</Badge>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-2 border-y border-line py-3">
        <ProductStat
          icon={<IconRooms className="size-3.5" />}
          label="RTC"
          value={metrics ? formatCount(metrics.connections) : undefined}
          unit="connections"
        />
        <ProductStat
          icon={<IconChat className="size-3.5" />}
          label="Chat"
          value={chat ? formatCount(chat.messagesSent) : undefined}
          unit="messages"
        />
        <ProductStat
          icon={<IconLiveStreaming className="size-3.5" />}
          label="Live"
          value={streams ? formatCount(liveStreams ?? 0) : undefined}
          unit="live now"
        />
      </dl>

      <div className="flex items-center justify-between">
        <span className="text-xs text-subtle" title={RANGE_LABEL[range]}>
          Last activity {formatRelative(project.updatedAt)}
        </span>
        <Link
          href={`/dashboard/projects/${project.id}/overview`}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
        >
          Open project
          <IconChevronRight className="size-3" />
        </Link>
      </div>
    </Card>
  );
}

function ProductStat({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | undefined;
  unit: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="flex items-center gap-1.5 text-xs text-subtle">
        {icon}
        <span className="mono-label text-[10px]">{label}</span>
      </dt>
      <dd className="tabular text-sm text-fg">
        {value ?? <span aria-label="unavailable">—</span>}
        {value !== undefined && <span className="ml-1 text-xs font-normal text-subtle">{unit}</span>}
      </dd>
    </div>
  );
}

/**
 * The zero-project state is a pitch, not an apology: what Raven does and
 * the one action that starts everything.
 */
function ZeroProjects() {
  return (
    <section className="flex flex-col items-center rounded border border-line bg-surface px-6 py-16 text-center">
      <h2 className="display text-2xl text-fg sm:text-3xl">Build your first realtime application</h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
        Create a Raven project and connect your application using our SDKs.
      </p>
      <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row">
        <ButtonLink href="/dashboard/projects?new=1" variant="primary">
          <IconPlus className="size-3.5" />
          Create your first project
        </ButtonLink>
        <ButtonLink href="/dashboard/developers" variant="ghost">
          Explore examples
        </ButtonLink>
      </div>

      <div className="mt-12 grid w-full max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
        <CapabilityCard glyph="🎥" title="RTC" description="Build voice and video experiences." />
        <CapabilityCard glyph="💬" title="Chat" description="Add realtime messaging." />
        <CapabilityCard glyph="📡" title="Live Streaming" description="Build scalable live experiences." />
      </div>
    </section>
  );
}

function CapabilityCard({ glyph, title, description }: { glyph: string; title: string; description: string }) {
  return (
    <div className="rounded border border-line bg-canvas p-4">
      <span aria-hidden className="text-lg">
        {glyph}
      </span>
      <p className="mt-2 text-sm font-medium text-fg">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}
