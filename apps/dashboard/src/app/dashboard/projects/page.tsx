import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { ErrorState } from '@/components/ui/states';
import { ProjectsList } from './projects-list';

export default async function ProjectsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  try {
    const projects = await ravenApi.listProjects(token);
    return <ProjectsList initialProjects={projects} />;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return <ErrorState title="Could not load projects" description="The Control API is unreachable right now. Try again shortly." />;
  }
}
