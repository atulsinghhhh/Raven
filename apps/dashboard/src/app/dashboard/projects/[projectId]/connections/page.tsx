import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi, type ConnectionLifecycleState } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { ProductTabs, rtcTabs } from '@/components/shell/product-tabs';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { IconConnections } from '@/components/ui/icons';
import { ConnectionFilters } from './connection-filters';
import { ConnectionsList } from './connections-list';

/**
 * The API filters by `state` and `roomId` and cursor-paginates from
 * there (QueryConnectionsDto) — see connections-list.tsx's "Load more".
 * Free-text search isn't a server capability, so `q` filters in memory,
 * client-side, and the UI says so rather than implying a full-history
 * search.
 */
const INITIAL_LIMIT = 200;

const STATES: ConnectionLifecycleState[] = ['CONNECTED', 'CONNECTING', 'RECONNECTING', 'DISCONNECTED', 'FAILED'];

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ state?: string; room?: string; q?: string }>;
}) {
  const { projectId } = await params;
  const { state: rawState, room, q } = await searchParams;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const state = (STATES as string[]).includes(rawState ?? '') ? (rawState as ConnectionLifecycleState) : undefined;

  const [connectionsResult, roomsResult] = await Promise.allSettled([
    ravenApi.listConnections(token, projectId, { state, roomId: room, limit: INITIAL_LIMIT }),
    ravenApi.listRooms(token, projectId),
  ]);

  if (connectionsResult.status === 'rejected') {
    const reason = connectionsResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Unable to load connections"
        description="The Control API is unreachable right now. Your telemetry is still being recorded."
        requestId={reason instanceof ApiError ? reason.code : undefined}
        retryHref={`/dashboard/projects/${projectId}/connections`}
      />
    );
  }

  const { data: fetched, nextCursor, hasMore } = connectionsResult.value;
  const rooms = roomsResult.status === 'fulfilled' ? roomsResult.value : [];

  const needle = q?.trim().toLowerCase();
  const connections = needle
    ? fetched.filter(
        (c) =>
          c.publicId.toLowerCase().includes(needle) ||
          c.participantIdentity.toLowerCase().includes(needle) ||
          c.roomName.toLowerCase().includes(needle),
      )
    : fetched;

  const base = `/dashboard/projects/${projectId}`;
  const filtered = Boolean(state || room || needle);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Connections" description="Every RTC connection reported by @ravenkash/rtc, newest first." />
      <ProductTabs tabs={rtcTabs(base)} active="Connections" />

      {fetched.length === 0 && !filtered ? (
        <EmptyState
          icon={<IconConnections className="size-7" />}
          title="No connections yet"
          description="A connection record appears here the moment a client joins a room with @ravenkash/rtc. Telemetry is automatic — you don't need to instrument anything."
          action={
            <>
              <ButtonLink href={`${base}/quickstart`} variant="primary">
                Open quickstart
              </ButtonLink>
              <ButtonLink href={`${base}/rooms`} variant="secondary">
                View rooms
              </ButtonLink>
            </>
          }
        />
      ) : (
        <>
          <ConnectionFilters basePath={`${base}/connections`} rooms={rooms} state={state} room={room} q={q} />

          {/* Keyed on the project and filters: either changing must fully
              remount this component so it starts from the fresh SSR page
              above rather than appending onto a cursor/list that belonged
              to the previous project or query (spec §7). */}
          <ConnectionsList
            key={`${projectId}:${state ?? ''}:${room ?? ''}:${q ?? ''}`}
            projectId={projectId}
            initialConnections={connections}
            initialNextCursor={nextCursor}
            initialHasMore={hasMore}
            state={state}
            room={room}
            q={q}
          />
        </>
      )}
    </div>
  );
}
