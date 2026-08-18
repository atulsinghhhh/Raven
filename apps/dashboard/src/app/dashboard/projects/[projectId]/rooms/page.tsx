import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';

export default async function RoomsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let rooms;
  try {
    rooms = await ravenApi.listRooms(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return <ErrorState title="Could not load rooms" description="The Control API is unreachable right now." />;
  }

  if (rooms.length === 0) {
    return (
      <EmptyState
        title="No rooms yet"
        description="Rooms are created by your backend via POST /v1/rooms using a project API key — see the Quickstart tab."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-left text-xs text-neutral-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 font-medium">Room</th>
            <th className="px-4 py-2 font-medium">Participants</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {rooms.map((room) => (
            <tr key={room.id}>
              <td className="px-4 py-2.5">
                <a
                  href={`/dashboard/projects/${projectId}/rooms/${room.id}`}
                  className="font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
                >
                  {room.name}
                </a>
              </td>
              <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">
                {room.liveParticipantCount === null ? <NoDataYet label="Unknown" /> : room.liveParticipantCount}
              </td>
              <td className="px-4 py-2.5">
                {room.liveParticipantCount === null ? (
                  <Badge tone="gray">Unknown</Badge>
                ) : room.liveParticipantCount > 0 ? (
                  <Badge tone="green">Active</Badge>
                ) : (
                  <Badge tone="gray">Idle</Badge>
                )}
              </td>
              <td className="px-4 py-2.5 text-neutral-500">{new Date(room.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
