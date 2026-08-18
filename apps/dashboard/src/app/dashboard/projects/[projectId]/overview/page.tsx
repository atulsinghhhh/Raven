import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { ErrorState, NoDataYet } from '@/components/ui/states';

export default async function OverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [projectResult, roomsResult, healthResult] = await Promise.allSettled([
    ravenApi.getProject(token, projectId),
    ravenApi.listRooms(token, projectId),
    ravenApi.getHealth(),
  ]);

  if (projectResult.status === 'rejected') {
    if (projectResult.reason instanceof ApiError && projectResult.reason.status === 401) redirect('/login');
    return <ErrorState title="Could not load project" description="The Control API is unreachable right now." />;
  }

  const project = projectResult.value;
  const rooms = roomsResult.status === 'fulfilled' ? roomsResult.value : undefined;
  const health = healthResult.status === 'fulfilled' ? healthResult.value : undefined;

  // Unreachable LiveKit means "unknown", not "0" — don't conflate the two.
  const liveDataAvailable = rooms !== undefined && rooms.every((r) => r.liveParticipantCount !== null);
  const activeRoomCount = rooms?.filter((r) => (r.liveParticipantCount ?? 0) > 0).length;
  const totalParticipants = rooms?.reduce((sum, r) => sum + (r.liveParticipantCount ?? 0), 0);

  // Only "Development" exists for now — the control plane doesn't issue
  // credentials for other environments yet.
  const environment = 'Development';

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Project" />
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-neutral-500">Project ID</dt>
            <dd className="font-mono text-xs mt-1 flex items-center gap-2 text-neutral-900 dark:text-neutral-100">
              {project.id}
              <CopyButton value={project.id} label="Copy" />
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Environment</dt>
            <dd className="mt-1 text-neutral-900 dark:text-neutral-100">{environment}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">RTC Endpoint</dt>
            <dd className="font-mono text-xs mt-1 text-neutral-900 dark:text-neutral-100">
              See <a href={`/dashboard/projects/${projectId}/quickstart`} className="underline">Quickstart</a>
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Status</dt>
            <dd className="mt-1 text-neutral-900 dark:text-neutral-100">{project.status}</dd>
          </div>
        </dl>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">Live activity</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Active rooms" value={liveDataAvailable ? activeRoomCount : <NoDataYet label="Unknown" />} />
          <StatCard label="Participants" value={liveDataAvailable ? totalParticipants : <NoDataYet label="Unknown" />} />
          <StatCard label="Total rooms" value={rooms ? rooms.length : <NoDataYet />} />
          <StatCard
            label="TURN usage"
            value={<NoDataYet label="Not yet available — see Usage" />}
          />
        </div>
      </div>

      <Card>
        <CardHeader title="Infrastructure health" subtitle="Live status from the Control API's own /health check." />
        {health ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-neutral-500 mb-1">API</div>
              <StatusBadge status={health.status === 'ok' || health.status === 'degraded' ? 'up' : 'unknown'} />
            </div>
            <div>
              <div className="text-neutral-500 mb-1">Database</div>
              <StatusBadge status={health.dependencies.database} />
            </div>
            <div>
              <div className="text-neutral-500 mb-1">SFU (LiveKit)</div>
              <StatusBadge status={health.dependencies.livekit} />
            </div>
            <div>
              <div className="text-neutral-500 mb-1">TURN</div>
              <StatusBadge status={health.dependencies.turn} />
            </div>
            <div>
              <div className="text-neutral-500 mb-1">Redis</div>
              <StatusBadge status={health.dependencies.redis} />
            </div>
          </div>
        ) : (
          <NoDataYet label="Health check unavailable right now" />
        )}
      </Card>
    </div>
  );
}
