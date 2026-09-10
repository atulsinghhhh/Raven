import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { AccountShell } from '@/components/shell/account-shell';
import { deriveSystemStatus } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { IconAudit } from '@/components/ui/icons';
import { formatRelative } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Activity — Livqeno',
};

/**
 * Cross-project activity. There is no global audit endpoint — audit logs
 * are project-scoped by design — so this merges each project's own feed.
 * Fan-out is capped and the cap is stated on screen.
 */
const PROJECT_LIMIT = 12;
const PER_PROJECT = 20;
const FEED_LIMIT = 50;

function humanizeAction(action: string): string {
  const text = action.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function ActivityPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');
  const email = decodeSessionEmail(token);

  const [projectsResult, healthResult] = await Promise.allSettled([ravenApi.listProjects(token), ravenApi.getHealth()]);
  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';

  if (projectsResult.status === 'rejected') {
    if (projectsResult.reason instanceof ApiError && projectsResult.reason.status === 401) redirect('/login');
    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        <ErrorState
          title="Could not load activity"
          description="The Control API is unreachable right now. Retry in a moment."
          retryHref="/dashboard/activity"
        />
      </AccountShell>
    );
  }

  const projects = [...projectsResult.value]
    .filter((p) => p.status === 'ACTIVE')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, PROJECT_LIMIT);

  const feeds = await Promise.allSettled(
    projects.map(async (project) => ({
      project,
      // A developer-role member's 403 reads as "no visible activity" for
      // that project, same as the overview page.
      entries: await ravenApi.listAuditLogs(token, project.id, { limit: PER_PROJECT }),
    })),
  );

  const feed = feeds
    .filter((f) => f.status === 'fulfilled')
    .flatMap((f) => f.value.entries.map((entry) => ({ entry, project: f.value.project })))
    .sort((a, b) => new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime())
    .slice(0, FEED_LIMIT);

  return (
    <AccountShell email={email} systemStatus={systemStatus}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Activity"
          description={`Administrative actions across your ${projects.length} most recently active projects.`}
          breadcrumb={{ label: 'Overview', href: '/dashboard' }}
        />

        {feed.length === 0 ? (
          <EmptyState
            icon={<IconAudit className="size-7" />}
            title="No activity yet"
            description="Administrative actions — keys created, members invited, webhooks configured — will appear here."
          />
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {feed.map(({ entry, project }) => (
                <li key={entry.id}>
                  <Link
                    href={`/dashboard/projects/${project.id}/audit`}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-raised"
                  >
                    <span className="mt-0.5 shrink-0 text-subtle">
                      <IconAudit className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{humanizeAction(entry.action)}</span>
                      <span className="block truncate text-xs text-muted">
                        {project.name} · {entry.actorEmail}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-xs text-subtle">{formatRelative(entry.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AccountShell>
  );
}
