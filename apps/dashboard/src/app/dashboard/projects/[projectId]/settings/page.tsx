import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { ProjectSettingsForm } from './project-settings-form';
import { DangerZone } from './danger-zone';

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let project;
  try {
    project = await ravenApi.getProject(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return <ErrorState title="Could not load project" description="The Control API is unreachable right now." />;
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <ProjectSettingsForm projectId={projectId} initialName={project.name} initialDescription={project.description ?? ''} />

      <Card>
        <CardHeader
          title="Allowed origins (CORS)"
          subtitle="Controls which browser origins may call the Control API — configured at the infrastructure level, not per-project yet."
        />
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Raven currently applies one <code>CORS_ORIGIN</code> setting across the whole API deployment, rather than per
          project. Per-project origin allowlists are planned but not implemented — see docs/dashboard.md#cors.
        </p>
      </Card>

      <Card>
        <CardHeader title="Webhooks" />
        <p className="text-sm text-neutral-500">Coming soon.</p>
      </Card>

      <DangerZone projectId={projectId} projectName={project.name} />
    </div>
  );
}
