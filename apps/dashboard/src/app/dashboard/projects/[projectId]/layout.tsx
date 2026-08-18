import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { ErrorState } from '@/components/ui/states';
import { ProjectNav } from './project-nav';

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

  try {
    const project = await ravenApi.getProject(token, projectId);

    return (
      <div className="flex flex-col gap-6">
        <div>
          <a href="/dashboard/projects" className="text-xs text-neutral-500 hover:underline">
            ← All projects
          </a>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-1">{project.name}</h1>
        </div>
        <ProjectNav projectId={projectId} />
        {children}
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorState title="Project not found" description="It may have been deleted, or it doesn't belong to your account." />;
    }
    return <ErrorState title="Could not load project" description="The Control API is unreachable right now. Try again shortly." />;
  }
}
