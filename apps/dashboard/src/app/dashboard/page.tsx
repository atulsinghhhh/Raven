import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ApiError, ravenApi, type AuditLogEntry, type Project, type ProjectDiagnostics } from '@/lib/api-client';
import { AccountShell } from '@/components/shell/account-shell';
import { Badge, deriveSystemStatus } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { RangeSelector } from '@/components/ui/range-selector';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { IconAudit, IconChevronRight, IconFolder, IconPlus } from '@/components/ui/icons';
import { formatCount, formatRelative, normaliseRange, RANGE_LABEL, type Range } from '@/lib/format';

/**
 * Account home: the first thing a developer with more than one project
 * sees. `/dashboard/projects` still exists as the full list + create
 * flow; this page is a cross-project summary that sits above it.
 *
 * There is no cross-project aggregate endpoint and no usage/billing
 * backend (see usage/page.tsx), so every number here is derived by
 * fetching each project's own per-project data and summing it: same
 * pattern as overview/page.tsx, just repeated per project. Live detail
 * is capped at DETAIL_LIMIT active projects (most recently updated
 * first) so this page doesn't fan out to dozens of API calls; the cap
 * is always stated on screen rather than silently truncating.
 */

const DETAIL_LIMIT = 8;
const ACTIVITY_LIMIT = 8;

interface ProjectSnapshot {
  project: Project;
  metrics?: { activeRooms: number; errors: number };
  diagnostics?: ProjectDiagnostics;
  liveRoomCount?: number;
  audit: AuditLogEntry[];
}

async function loadSnapshot(token: string, project: Project, range: Range): Promise<ProjectSnapshot> {
  const [metricsR, diagnosticsR, roomsR, auditR] = await Promise.allSettled([
    ravenApi.getMetrics(token, project.id, range),
    ravenApi.getDiagnostics(token, project.id),
    ravenApi.listRooms(token, project.id),
    ravenApi.listAuditLogs(token, project.id, { limit: 5 }),
  ]);

  return {
    project,
    metrics: metricsR.status === 'fulfilled' ? metricsR.value : undefined,
    diagnostics: diagnosticsR.status === 'fulfilled' ? diagnosticsR.value : undefined,
    liveRoomCount: roomsR.status === 'fulfilled' ? roomsR.value.filter((r) => (r.liveParticipantCount ?? 0) > 0).length : undefined,
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

export default async function DashboardHomePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const range = normaliseRange((await searchParams).range);
  const email = decodeSessionEmail(token);

  const [projectsResult, healthResult] = await Promise.allSettled([ravenApi.listProjects(token), ravenApi.getHealth()]);

  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';

  if (projectsResult.status === 'rejected') {
    if (projectsResult.reason instanceof ApiError && projectsResult.reason.status === 401) redirect('/login');
    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        <ErrorState
          title="Could not load your account"
          description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
          retryHref="/dashboard"
        />
      </AccountShell>
    );
  }

  const projects = projectsResult.value;

  if (projects.length === 0) {
    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        <div className="flex flex-col gap-8">
          <PageHeader title="Home" description="A cross-project summary of your account." />
          <EmptyState
            icon={<IconFolder className="size-7" />}
            title="No projects yet"
            description="A project groups your API keys, rooms, and connection telemetry. Create one to get your first RTC token."
            action={
              <ButtonLink href="/dashboard/projects?new=1" variant="primary">
                <IconPlus className="size-3.5" />
                Create your first project
              </ButtonLink>
            }
          />
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

  const metricsSnapshots = snapshots.filter((s) => s.metrics);
  const diagnosticsSnapshots = snapshots.filter((s) => s.diagnostics);

  const activeRooms = metricsSnapshots.length
    ? metricsSnapshots.reduce((sum, s) => sum + (s.metrics?.activeRooms ?? 0), 0)
    : null;
  const errorsInWindow = metricsSnapshots.length
    ? metricsSnapshots.reduce((sum, s) => sum + (s.metrics?.errors ?? 0), 0)
    : null;
  const activeConnections = diagnosticsSnapshots.length
    ? diagnosticsSnapshots.reduce((sum, s) => sum + (s.diagnostics?.connections.active ?? 0), 0)
    : null;

  const attentionSnapshots = diagnosticsSnapshots.filter((s) => {
    const status = deriveSystemStatus(s.diagnostics!.dependencies);
    return status !== 'operational';
  });

  const activityFeed = snapshots
    .flatMap((s) => s.audit.map((entry) => ({ entry, projectName: s.project.name, projectId: s.project.id })))
    .sort((a, b) => new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime())
    .slice(0, ACTIVITY_LIMIT);

  const detailHint = truncatedCount > 0 ? `Live data for the ${detailProjects.length} most recently active` : undefined;

  return (
    <AccountShell email={email} systemStatus={systemStatus}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Home"
          description="A cross-project summary of your account."
          actions={
            <>
              <RangeSelector basePath="/dashboard" current={range} />
              <ButtonLink href="/dashboard/projects?new=1" variant="secondary">
                <IconPlus className="size-3.5" />
                New project
              </ButtonLink>
            </>
          }
        />

        <section>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Projects" value={formatCount(projects.length)} hint={detailHint} />
            <StatCard label="Active rooms" value={activeRooms !== null ? formatCount(activeRooms) : <NoDataYet label="Unknown" />} />
            <StatCard
              label="Active connections"
              value={activeConnections !== null ? formatCount(activeConnections) : <NoDataYet label="Unknown" />}
            />
            <StatCard
              label="Errors"
              value={errorsInWindow !== null ? formatCount(errorsInWindow) : <NoDataYet label="Unknown" />}
              hint={RANGE_LABEL[range]}
              tone={errorsInWindow ? 'warning' : 'default'}
            />
          </div>
        </section>

        {attentionSnapshots.length > 0 && (
          <section>
            <SectionHeader title="Needs attention" subtitle="Projects with a degraded or unreachable dependency." />
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {attentionSnapshots.map((s) => {
                  const deps = s.diagnostics!.dependencies;
                  const down = Object.entries(deps).filter(([, v]) => v === 'down');
                  return (
                    <li key={s.project.id}>
                      <a
                        href={`/dashboard/projects/${s.project.id}/diagnostics`}
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-raised"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">{s.project.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {down.length > 0
                              ? `${down.map(([dep]) => dep).join(', ')} unreachable`
                              : 'Elevated failure rate'}
                          </span>
                        </span>
                        <Badge tone="danger">Down</Badge>
                        <IconChevronRight className="size-4 shrink-0 text-subtle" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader title="Recent activity" subtitle="Across your most recently active projects." />
            </div>
            {activityFeed.length === 0 ? (
              <div className="px-5 pb-5">
                <NoDataYet label="No recent activity" />
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {activityFeed.map(({ entry, projectName, projectId }) => (
                  <li key={entry.id}>
                    <a
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
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader
                title="Projects"
                action={
                  <Link href="/dashboard/projects" className="text-xs font-medium text-accent-text hover:underline">
                    View all
                  </Link>
                }
              />
            </div>
            <ul className="divide-y divide-line border-t border-line">
              {snapshots.map((s) => (
                <li key={s.project.id}>
                  <a
                    href={`/dashboard/projects/${s.project.id}/metrics`}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-raised"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{s.project.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {s.liveRoomCount !== undefined ? `${formatCount(s.liveRoomCount)} live rooms — view metrics` : 'Room data unavailable'}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-xs text-subtle">{formatRelative(s.project.updatedAt)}</span>
                    <IconChevronRight className="size-4 shrink-0 text-subtle" />
                  </a>
                </li>
              ))}
            </ul>
            {truncatedCount > 0 && (
              <div className="border-t border-line px-5 py-3 text-xs text-muted">
                +{formatCount(truncatedCount)} more —{' '}
                <Link href="/dashboard/projects" className="text-accent-text hover:underline">
                  view all projects
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AccountShell>
  );
}
