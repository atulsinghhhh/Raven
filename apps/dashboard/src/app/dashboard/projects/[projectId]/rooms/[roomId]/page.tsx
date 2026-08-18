import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { TestTokenPanel } from './test-token-panel';

export default async function RoomDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; roomId: string }>;
}) {
  const { projectId, roomId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let room;
  try {
    room = await ravenApi.getRoom(token, projectId, roomId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorState title="Room not found" description="It may have been closed, or it doesn't belong to this project." />;
    }
    return <ErrorState title="Could not load room" description="The Control API is unreachable right now." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <a href={`/dashboard/projects/${projectId}/rooms`} className="text-xs text-neutral-500 hover:underline">
          ← All rooms
        </a>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mt-1">Room: {room.name}</h2>
      </div>

      <Card>
        <CardHeader title="Participants" subtitle="Live state from LiveKit, not a stored history." />
        {room.liveParticipants === null ? (
          <NoDataYet label="Live participant data is unavailable — the SFU could not be reached" />
        ) : room.liveParticipants.length === 0 ? (
          <EmptyState title="No one is connected right now" />
        ) : (
          <ul className="flex flex-col gap-3">
            {room.liveParticipants.map((participant) => (
              <li key={participant.identity} className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
                <div className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{participant.identity}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  Joined {new Date(participant.joinedAt).toLocaleString()}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {participant.tracks.length === 0 ? (
                    <span className="text-xs text-neutral-400 italic">No published tracks</span>
                  ) : (
                    participant.tracks.map((track) => (
                      <Badge key={track.sid} tone={track.muted ? 'gray' : 'green'}>
                        {track.kind}
                        {track.muted ? ' (muted)' : ''}
                      </Badge>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TestTokenPanel projectId={projectId} roomId={roomId} />
    </div>
  );
}
