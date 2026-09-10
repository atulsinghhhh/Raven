import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { AccountShell } from '@/components/shell/account-shell';
import { deriveSystemStatus } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/states';
import { ProjectsList } from './projects-list';

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const { new: openCreate } = await searchParams;
  const email = decodeSessionEmail(token);

  const [projectsResult, healthResult] = await Promise.allSettled([ravenApi.listProjects(token), ravenApi.getHealth()]);

  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';

  if (projectsResult.status === 'rejected') {
    if (projectsResult.reason instanceof ApiError && projectsResult.reason.status === 401) redirect('/login');
    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        <ErrorState
          title="Could not load your projects"
          description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
          retryHref="/dashboard/projects"
        />
      </AccountShell>
    );
  }

  return (
    <AccountShell email={email} systemStatus={systemStatus}>
      <ProjectsList initialProjects={projectsResult.value} autoOpenCreate={openCreate === '1'} />
    </AccountShell>
  );
}
