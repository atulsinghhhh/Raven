import { NextRequest, NextResponse } from 'next/server';
import { ravenApi, type ConnectionLifecycleState } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

const STATES: ConnectionLifecycleState[] = ['CONNECTED', 'CONNECTING', 'RECONNECTING', 'DISCONNECTED', 'FAILED'];

/**
 * Backs the "Load more" control on the connections page
 * (connections-list.tsx). The initial page is still fetched server-side
 * in page.tsx, same as before — this route only serves subsequent pages,
 * since those are triggered by a client interaction with no server
 * round-trip of their own to piggyback on.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  const { projectId } = await params;
  const search = request.nextUrl.searchParams;
  const rawState = search.get('state') ?? undefined;
  const state = (STATES as string[]).includes(rawState ?? '') ? (rawState as ConnectionLifecycleState) : undefined;
  const roomId = search.get('room') ?? undefined;
  const cursor = search.get('cursor') ?? undefined;

  try {
    const page = await ravenApi.listConnections(token, projectId, { state, roomId, cursor, limit: 200 });
    return NextResponse.json(page);
  } catch (error) {
    return handleApiError(error);
  }
}
