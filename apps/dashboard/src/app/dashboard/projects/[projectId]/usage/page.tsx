import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { ErrorState, NoDataYet } from '@/components/ui/states';

// No usage metering or billing yet (that's a later phase), so this page only
// shows what we can actually compute right now — room counts, live
// participants — and says so plainly for everything else instead of faking numbers.
export default async function UsagePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let rooms;
  try {
    rooms = await ravenApi.listRooms(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return <ErrorState title="Could not load usage" description="The Control API is unreachable right now." />;
  }

  const liveDataAvailable = rooms.every((r) => r.liveParticipantCount !== null);
  const totalParticipants = rooms.reduce((sum, r) => sum + (r.liveParticipantCount ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Current period" subtitle="Live snapshot, not a historical aggregate — see below." />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard label="Rooms (all-time, active)" value={rooms.length} />
          <StatCard label="Participants (right now)" value={liveDataAvailable ? totalParticipants : <NoDataYet label="Unknown" />} />
          <StatCard label="Connections" value={<NoDataYet />} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Not yet available" />
        <ul className="text-sm text-neutral-600 dark:text-neutral-400 list-disc list-inside space-y-1">
          <li>Participant-minutes (historical connection duration aggregation)</li>
          <li>TURN relay bandwidth usage</li>
          <li>Published-track counts over time</li>
          <li>Per-day/per-month usage history</li>
        </ul>
        <p className="text-xs text-neutral-500 mt-3">
          Raven doesn&apos;t yet meter or store historical usage data — this page shows only what can be computed live
          from current infrastructure state. Usage metering is planned for a later phase.
        </p>
      </Card>
    </div>
  );
}
