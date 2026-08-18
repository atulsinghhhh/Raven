import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/states';
import { ApiKeysManager } from './api-keys-manager';

export default async function ApiKeysPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let keys;
  try {
    keys = await ravenApi.listApiKeys(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return <ErrorState title="Could not load API keys" description="The Control API is unreachable right now." />;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="API keys"
        description="Server-side credentials for this project. A key mints RTC tokens and reads project data through the Control API — it is never used from a browser."
        actions={
          <ButtonLink href={`/dashboard/projects/${projectId}/quickstart`} variant="secondary">
            Quickstart
          </ButtonLink>
        }
      />
      <ApiKeysManager projectId={projectId} initialKeys={keys} />
    </div>
  );
}
