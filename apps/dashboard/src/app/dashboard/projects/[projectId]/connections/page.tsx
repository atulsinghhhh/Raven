import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/card';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';

const RANGES = ['15m', '1h', '24h', '7d'] as const;
type Range = (typeof RANGES)[number];

const STATE_TONE: Record<string, 'green' | 'red' | 'gray' | 'yellow'> = {
  CONNECTED: 'green',
  CONNECTING: 'yellow',
  RECONNECTING: 'yellow',
  DISCONNECTED: 'gray',
  FAILED: 'red',
};

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { projectId } = await params;
  const { range: rawRange } = await searchParams;
  const range: Range = (RANGES as readonly string[]).includes(rawRange ?? '') ? (rawRange as Range) : '1h';

  const token = await getSessionToken();
  if (!token) redirect('/login');

  let overview;
  let connections;
  try {
    [overview, connections] = await Promise.all([
      ravenApi.getMetrics(token, projectId, range),
      ravenApi.listConnections(token, projectId),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return <ErrorState title="Could not load connections" description="The Control API is unreachable right now." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Observability</h2>
        <nav aria-label="Time range" className="flex gap-1 text-xs">
          {RANGES.map((r) => (
            <a
              key={r}
              href={`?range=${r}`}
              className={`rounded-md px-2 py-1 ${
                r === range
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {r === '15m' ? 'Last 15 minutes' : r === '1h' ? 'Last hour' : r === '24h' ? 'Last 24 hours' : 'Last 7 days'}
            </a>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active rooms" value={overview.activeRooms} />
        <StatCard label="Active participants" value={overview.activeParticipants} />
        <StatCard
          label="Connection success"
          value={overview.connectionSuccessRate === null ? <NoDataYet /> : `${overview.connectionSuccessRate}%`}
        />
        <StatCard label="Errors" value={overview.errors} />
        <StatCard
          label="Reconnection rate"
          value={overview.reconnectionRate === null ? <NoDataYet /> : `${overview.reconnectionRate}%`}
        />
        <StatCard
          label="Avg. duration"
          value={overview.averageConnectionDurationMs === null ? <NoDataYet /> : formatDuration(overview.averageConnectionDurationMs)}
        />
      </div>

      {connections.length === 0 ? (
        <EmptyState
          title="No connections yet"
          description="Real connections appear here once a client using @raven/rtc joins a room — see docs/telemetry.md."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-left text-xs text-neutral-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 font-medium">Connection</th>
                <th className="px-4 py-2 font-medium">Room</th>
                <th className="px-4 py-2 font-medium">Participant</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">SDK</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {connections.map((c) => (
                <tr key={c.publicId}>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <a
                      href={`/dashboard/projects/${projectId}/connections/${c.publicId}`}
                      className="text-neutral-900 dark:text-neutral-100 hover:underline"
                    >
                      {c.publicId}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">{c.roomName}</td>
                  <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">{c.participantIdentity}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATE_TONE[c.state] ?? 'gray'}>{c.state}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-500">{formatDuration(c.durationMs)}</td>
                  <td className="px-4 py-2.5 text-neutral-500">{c.sdkVersion ?? '—'}</td>
                  <td className="px-4 py-2.5 text-neutral-500">{new Date(c.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
