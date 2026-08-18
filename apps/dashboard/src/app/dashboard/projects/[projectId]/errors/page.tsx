import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/ui/states';

export default async function ErrorsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let errors;
  try {
    errors = await ravenApi.listErrors(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return <ErrorState title="Could not load errors" description="The Control API is unreachable right now." />;
  }

  if (errors.length === 0) {
    return <EmptyState title="No errors recorded" description="Good sign — or no connections have been made yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-left text-xs text-neutral-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 font-medium">Error</th>
            <th className="px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 font-medium">Message</th>
            <th className="px-4 py-2 font-medium">Connection</th>
            <th className="px-4 py-2 font-medium">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {errors.map((e) => (
            <tr key={e.publicId}>
              <td className="px-4 py-2.5 font-mono text-xs">
                <a
                  href={`/dashboard/projects/${projectId}/errors/${e.publicId}`}
                  className="text-neutral-900 dark:text-neutral-100 hover:underline"
                >
                  {e.publicId}
                </a>
              </td>
              <td className="px-4 py-2.5">
                <Badge tone="red">{e.category}</Badge>
              </td>
              <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300 max-w-sm truncate">{e.message}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">
                {e.connectionId ? (
                  <a href={`/dashboard/projects/${projectId}/connections/${e.connectionId}`} className="hover:underline">
                    {e.connectionId}
                  </a>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-4 py-2.5 text-neutral-500">{new Date(e.timestamp).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
