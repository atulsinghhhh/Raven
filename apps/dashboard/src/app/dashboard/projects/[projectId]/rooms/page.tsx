import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { ProductTabs, rtcTabs } from '@/components/shell/product-tabs';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { IconRooms } from '@/components/ui/icons';
import { RoomsList } from './rooms-list';

// listConnections is capped at 200 server-side; the per-room "active
// connections" column is derived from exactly that window and is labelled
// as such rather than presented as an all-time total.
const CONNECTION_SCAN_LIMIT = 200;

export default async function RoomsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  // Rooms are load-bearing for this page; the connection scan that backs the
  // derived column is not, so it degrades to "Unknown" on its own.
  const [roomsResult, connectionsResult] = await Promise.allSettled([
    ravenApi.listRooms(token, projectId),
    ravenApi.listConnections(token, projectId, { limit: CONNECTION_SCAN_LIMIT }),
  ]);

  if (roomsResult.status === 'rejected') {
    const reason = roomsResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    if (reason instanceof ApiError && reason.status === 404) {
      return (
        <EmptyState
          title="Project not found"
          description="This project may have been archived, or it belongs to a different account."
          action={
            <ButtonLink href="/dashboard/projects" variant="primary">
              Back to projects
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load rooms"
        description="The Control API is unreachable right now. Your rooms are unaffected — retry in a moment."
        retryHref={`/dashboard/projects/${projectId}/rooms`}
      />
    );
  }

  const rooms = roomsResult.value;
  // listConnections returns a cursor-paginated page; this derived column
  // only ever wanted the first CONNECTION_SCAN_LIMIT records anyway.
  const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value.data : undefined;

  const base = `/dashboard/projects/${projectId}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Rooms"
        description="Every room your backend has created in this project, with live occupancy read from the SFU at page load."
        actions={
          <ButtonLink href={`${base}/quickstart`} variant="secondary">
            How rooms are created
          </ButtonLink>
        }
      />
      <ProductTabs tabs={rtcTabs(base)} active="Rooms" />

      {rooms.length === 0 ? (
        <EmptyState
          icon={<IconRooms className="size-7" />}
          title="No rooms yet"
          description={
            <>
              Livqeno never creates rooms from the dashboard. Your backend creates them by calling the Control API with
              a project API key — <code className="font-mono text-xs text-fg">POST /v1/rooms</code> via{' '}
              <code className="font-mono text-xs text-fg">@ravenkash/server</code> — and they appear here the moment
              they exist.
            </>
          }
          action={
            <>
              <ButtonLink href={`${base}/quickstart`} variant="primary">
                Open quickstart
              </ButtonLink>
              <ButtonLink href={`${base}/api-keys`} variant="secondary">
                Create an API key
              </ButtonLink>
            </>
          }
        />
      ) : (
        <RoomsList key={projectId} projectId={projectId} initialRooms={rooms} connections={connections} />
      )}
    </div>
  );
}
