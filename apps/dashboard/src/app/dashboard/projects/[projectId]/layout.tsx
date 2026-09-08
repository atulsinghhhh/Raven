import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { AppShell } from '@/components/shell/app-shell';
import { AccountShell } from '@/components/shell/account-shell';
import { deriveSystemStatus } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { buildNotifications } from '@/lib/notifications';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const email = decodeSessionEmail(token);

  // The switcher needs every project and the header needs live health, but
  // neither should be able to take the page down: only the project itself
  // is load-bearing, so the other two are allowed to fail.
  const [projectResult, projectsResult, healthResult] = await Promise.allSettled([
    ravenApi.getProject(token, projectId),
    ravenApi.listProjects(token),
    ravenApi.getHealth(),
  ]);

  if (projectResult.status === 'rejected') {
    const reason = projectResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');

    const systemStatus =
      healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';

    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        {reason instanceof ApiError && reason.status === 404 ? (
          <EmptyState
            title="Project not found"
            description="It may have been archived, or it belongs to a different account."
            action={<ButtonLink href="/dashboard/projects" variant="primary">Back to projects</ButtonLink>}
          />
        ) : (
          <ErrorState
            title="Could not load this project"
            description="The Control API is unreachable right now. Your data is unaffected — retry in a moment."
            retryHref={`/dashboard/projects/${projectId}/overview`}
          />
        )}
      </AccountShell>
    );
  }

  const project = projectResult.value;
  const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : [project];
  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';

  // None of these are load-bearing for the page itself: a 403 (no
  // audit:read capability) or a transient failure just means that source
  // contributes nothing, not that the whole shell breaks.
  const [diagnosticsResult, auditLogsResult, webhooksResult] = await Promise.allSettled([
    ravenApi.getDiagnostics(token, projectId),
    ravenApi.listAuditLogs(token, projectId, { limit: 5 }),
    ravenApi.listWebhooks(token, projectId),
  ]);

  const notifications = buildNotifications({
    projectId,
    diagnostics: diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : undefined,
    auditLogs: auditLogsResult.status === 'fulfilled' ? auditLogsResult.value : undefined,
    webhooks: webhooksResult.status === 'fulfilled' ? webhooksResult.value : undefined,
  });

  return (
    <AppShell
      projects={projects}
      currentProject={project}
      email={email}
      systemStatus={systemStatus}
      notifications={notifications}
    >
      {children}
    </AppShell>
  );
}
