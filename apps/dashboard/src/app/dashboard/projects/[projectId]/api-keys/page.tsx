import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
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

  return <ApiKeysManager projectId={projectId} initialKeys={keys} />;
}
