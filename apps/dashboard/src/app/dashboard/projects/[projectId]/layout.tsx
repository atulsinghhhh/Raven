import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { AppShell } from '@/components/shell/app-shell';
import { AccountShell } from '@/components/shell/account-shell';
import { deriveSystemStatus } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';

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
            action={
              <ButtonLink href="/dashboard/projects" variant="primary">
                Back to projects
              </ButtonLink>
            }
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

  // Not load-bearing for the page itself: a transient failure just means
  // capabilities resolve to "none" (see below), not that the whole shell
  // breaks. NotificationsBell (Phase 5F) fetches its own data client-side
  // now — this layout no longer needs diagnostics/audit/webhooks just to
  // feed it a derived list.
  const membersResult = await ravenApi.listMembers(token, projectId).catch(() => undefined);

  // Same lookup members/page.tsx already does: the API sends each
  // member's resolved capability list rather than the dashboard
  // re-deriving it from a role (see lib/permissions.ts), so this finds
  // the caller's own row in the member list it already fetched. An empty
  // array — not fetched, or the caller isn't listed — means "no
  // capabilities" (Phase 1's can() treats that as fully unprivileged),
  // never "everything".
  const members = membersResult ?? [];
  const capabilities = members.find((m) => m.email === email)?.capabilities ?? [];

  return (
    <AppShell
      projects={projects}
      currentProject={project}
      capabilities={capabilities}
      email={email}
      systemStatus={systemStatus}
      // Distinguishes "the member list failed to load" from "you legitimately
      // have no capabilities" — both resolve to the same deny-by-default `[]`
      // above, but only the former is worth telling the user about.
      capabilitiesUnavailable={membersResult === undefined}
    >
      {children}
    </AppShell>
  );
}
