import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { MonoId } from '@/components/ui/mono';
import { ErrorState } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import { ProjectSettingsForm } from './project-settings-form';
import { DangerZone } from './danger-zone';

/**
 * Only two things here actually write: PATCH /api/projects/:id (name and
 * description) and DELETE /api/projects/:id (archive). CORS is an honest
 * note about a capability that doesn't exist per-project yet. Webhooks
 * have their own dedicated CRUD page (see nav.ts) — this page just
 * points there rather than duplicating it.
 */
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

  const active = project.status === 'ACTIVE';

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Settings"
        description="Project details, integration notes, and the archive action."
        meta={<Badge tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Archived'}</Badge>}
      />

      <ProjectSettingsForm
        projectId={projectId}
        initialName={project.name}
        initialDescription={project.description ?? ''}
      />

      <Card>
        <CardHeader title="Project details" subtitle="Read-only. The project ID is what every SDK and API call is scoped to." />
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <MetaRow label="Project ID">
            <MonoId value={project.id} copy />
          </MetaRow>
          <MetaRow label="Status">
            <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Archived'}</Badge>
          </MetaRow>
          <MetaRow label="Created">
            <span className="tabular text-sm text-fg">{formatDateTime(project.createdAt)}</span>
          </MetaRow>
          <MetaRow label="Last updated">
            <span className="tabular text-sm text-fg">{formatDateTime(project.updatedAt)}</span>
          </MetaRow>
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="Allowed origins (CORS)"
          subtitle="Controls which browser origins may call the Control API — configured at the infrastructure level, not per project yet."
        />
        <p className="text-sm leading-relaxed text-muted">
          Raven currently applies one <code className="font-mono text-xs text-fg">CORS_ORIGIN</code> setting across the
          whole API deployment, rather than per project. Per-project origin allowlists are planned but not implemented
          — see <code className="font-mono text-xs text-fg">docs/dashboard.md#cors</code>. Changing the allowlist means
          changing that deployment&apos;s configuration; there is nothing to set here.
        </p>
      </Card>

      <Card>
        <CardHeader title="Webhooks" subtitle="Register an endpoint to receive chat and live-stream lifecycle events." />
        <p className="text-sm leading-relaxed text-muted">
          Managed on its own page — create an endpoint, choose which events it receives, and inspect delivery
          attempts.
        </p>
        <a
          href={`/dashboard/projects/${projectId}/webhooks`}
          className="mt-3 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
        >
          Manage webhooks →
        </a>
      </Card>

      <DangerZone projectId={projectId} projectName={project.name} />
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1.5 min-w-0">{children}</dd>
    </div>
  );
}
