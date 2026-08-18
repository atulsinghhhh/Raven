import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';

const STATE_TONE: Record<string, 'green' | 'red' | 'gray' | 'yellow'> = {
  CONNECTED: 'green',
  CONNECTING: 'yellow',
  RECONNECTING: 'yellow',
  DISCONNECTED: 'gray',
  FAILED: 'red',
};

export default async function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; connectionId: string }>;
}) {
  const { projectId, connectionId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let connection;
  try {
    connection = await ravenApi.getConnection(token, projectId, connectionId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorState title="Connection not found" description="It may have aged out under this project's retention policy." />;
    }
    return <ErrorState title="Could not load this connection" description="The Control API is unreachable right now." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <a href={`/dashboard/projects/${projectId}/connections`} className="text-xs text-neutral-500 hover:underline">
          ← All connections
        </a>
        <div className="flex items-center gap-3 mt-1">
          <h2 className="text-lg font-semibold font-mono text-neutral-900 dark:text-neutral-100">{connection.publicId}</h2>
          <Badge tone={STATE_TONE[connection.state] ?? 'gray'}>{connection.state}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Field label="Room" value={connection.roomName} />
        <Field label="Participant" value={connection.participantIdentity} />
        <Field label="Reconnect count" value={String(connection.reconnectCount)} />
        <Field label="SDK version" value={connection.sdkVersion ?? '—'} />
        <Field label="Platform" value={[connection.platform, connection.browser].filter(Boolean).join(' / ') || '—'} />
        <Field label="Region" value={connection.region ?? '—'} />
        <Field label="Started" value={new Date(connection.startedAt).toLocaleString()} />
        <Field label="Connected" value={connection.connectedAt ? new Date(connection.connectedAt).toLocaleString() : '—'} />
        <Field label="Disconnected" value={connection.disconnectedAt ? new Date(connection.disconnectedAt).toLocaleString() : '—'} />
        <Field label="Duration" value={formatDuration(connection.durationMs)} />
      </div>

      {connection.errors.length > 0 && (
        <Card>
          <CardHeader title="Errors on this connection" />
          <ul className="flex flex-col gap-3">
            {connection.errors.map((error) => (
              <li key={error.publicId} className="rounded-md border border-red-200 dark:border-red-900/50 p-3">
                <div className="flex items-center gap-2">
                  <Badge tone="red">{error.category}</Badge>
                  <a
                    href={`/dashboard/projects/${projectId}/errors/${error.publicId}`}
                    className="text-xs font-mono text-neutral-500 hover:underline"
                  >
                    {error.publicId}
                  </a>
                </div>
                <p className="text-sm text-neutral-700 dark:text-neutral-300 mt-1">{error.message}</p>
                {error.suggestedAction && <p className="text-xs text-neutral-500 mt-1">Suggestion: {error.suggestedAction}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Timeline" subtitle="Every lifecycle event this connection reported, in order." />
        <ol className="flex flex-col gap-2">
          {connection.events.map((event) => (
            <li key={event.id} className="flex gap-3 text-sm">
              <span className="text-neutral-400 tabular-nums shrink-0">{new Date(event.timestamp).toLocaleTimeString()}</span>
              <span className="text-neutral-700 dark:text-neutral-300">{event.type}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-neutral-900 dark:text-neutral-100 mt-0.5">{value}</div>
    </div>
  );
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
