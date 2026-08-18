import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';

export default async function ErrorDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; errorId: string }>;
}) {
  const { projectId, errorId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let error;
  try {
    error = await ravenApi.getError(token, projectId, errorId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login');
    if (err instanceof ApiError && err.status === 404) {
      return <ErrorState title="Error not found" description="It may have aged out under this project's retention policy." />;
    }
    return <ErrorState title="Could not load this error" description="The Control API is unreachable right now." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <a href={`/dashboard/projects/${projectId}/errors`} className="text-xs text-neutral-500 hover:underline">
          ← All errors
        </a>
        <div className="flex items-center gap-3 mt-1">
          <Badge tone="red">{error.category}</Badge>
          <h2 className="text-sm font-mono text-neutral-500">{error.publicId}</h2>
        </div>
      </div>

      <Card>
        <p className="text-sm text-neutral-900 dark:text-neutral-100">{error.message}</p>
      </Card>

      {(error.likelyCause || error.suggestedAction) && (
        <Card>
          <CardHeader title="Diagnosis" subtitle="A best-effort explanation, not a certainty — see docs/error-codes.md." />
          {error.likelyCause && (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              <span className="font-medium">Likely cause:</span> {error.likelyCause}
            </p>
          )}
          {error.suggestedAction && (
            <p className="text-sm text-neutral-700 dark:text-neutral-300 mt-2">
              <span className="font-medium">Suggested action:</span> {error.suggestedAction}
            </p>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Field label="When" value={new Date(error.timestamp).toLocaleString()} />
        <Field label="SDK version" value={error.sdkVersion ?? '—'} />
        <Field label="Platform" value={error.platform ?? '—'} />
        <Field
          label="Connection"
          value={error.connectionId ?? '—'}
          href={error.connectionId ? `/dashboard/projects/${projectId}/connections/${error.connectionId}` : undefined}
        />
      </div>
    </div>
  );
}

function Field({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-neutral-900 dark:text-neutral-100 mt-0.5 font-mono">
        {href ? <a href={href} className="hover:underline">{value}</a> : value}
      </div>
    </div>
  );
}
